// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {
  ICasinoGameV2,
  SessionContext,
  SessionPhase,
  StepResult
} from "./ICasinoGameV2.sol";

/**
 * @title GravitySlingshot: Grand Tour
 * @notice Press-your-luck route builder. The player flies a probe through up to four
 *         gravity assists. Each leg they pick a body, and the next body must differ from
 *         the last one (you cannot slingshot the body you are leaving). Every leg draws
 *         fresh VRF randomness. After each surviving assist the player either EJECTS and
 *         banks the tour value, or burns onward to the next body.
 *
 *           body         survive   leg multiplier
 *           Comet          90%        10/9x  (1.11x)
 *           Moon           80%        5/4x   (1.25x)
 *           Neptune        75%        4/3x   (1.33x)
 *           Saturn         62.5%      8/5x   (1.6x)
 *           Jupiter        50%        2x
 *           Red giant      40%        5/2x   (2.5x)
 *           Pulsar         25%        4x
 *           Black hole     12.5%      8x
 *
 *         survive * multiplier = 1 exactly on every leg, so each leg is a fair bet and the
 *         tour value is a martingale. The 7% house edge is applied once, at settlement:
 *           payout = wager * product(leg multipliers) * 0.93
 *         Expected payout is therefore 93% of the wager under ANY route or stopping rule
 *         (settlement floors to the wei, never in the player's favor). The top route
 *         (Pulsar, Black hole, Pulsar, Black hole) pays 952.32x; every other body is at
 *         most 4x, so adding bodies never raises the cap.
 * @dev A strategy can only condition on "survived so far", so every strategy is a fixed
 *      route plus an eject point. Tests enumerate all of them through these handlers.
 */
contract GravitySlingshot is ICasinoGameV2 {
  uint256 public constant WAD = 1e18;
  uint256 public constant BASIS_POINTS = 10_000;
  uint256 public constant RTP_BPS = 9_300; // 93% RTP, 7% house edge
  uint256 public constant MAX_REHASH_ATTEMPTS = 8;
  uint256 public constant TOUR_STATE_BYTES = 352; // 11 ABI words, see _encodeTour

  uint8 public constant MAX_LEGS = 4;
  uint8 public constant BODY_COUNT = 8;
  uint8 public constant NO_BODY = 255;

  uint8 public constant MOON = 0;
  uint8 public constant JUPITER = 1;
  uint8 public constant PULSAR = 2;
  uint8 public constant BLACK_HOLE = 3;
  uint8 public constant COMET = 4;
  uint8 public constant NEPTUNE = 5;
  uint8 public constant SATURN = 6;
  uint8 public constant RED_GIANT = 7;

  uint8 public constant ACTION_LAUNCH = 1;
  uint8 public constant ACTION_EJECT = 2;

  uint8 public constant STATUS_CRUISING = 0; // survived the last leg, player to act
  uint8 public constant STATUS_BURNING = 1; // leg launched, waiting for VRF
  uint8 public constant STATUS_CAPTURED = 2; // lost: probe captured by the body
  uint8 public constant STATUS_EJECTED = 3; // won: player banked mid-tour
  uint8 public constant STATUS_COMPLETE = 4; // won: survived all four legs

  error GravitySlingshot__InvalidWager(uint256 wager);
  error GravitySlingshot__InvalidGameData();
  error GravitySlingshot__InvalidTourState();
  error GravitySlingshot__InvalidBody(uint8 body);
  error GravitySlingshot__RepeatBody(uint8 body);
  error GravitySlingshot__TourComplete();
  error GravitySlingshot__InvalidAction(uint8 action);
  error GravitySlingshot__NotCruising(uint8 status);
  error GravitySlingshot__NotBurning(uint8 status);
  error GravitySlingshot__EntropyExhausted();

  struct Tour {
    uint8 status;
    uint8 legs; // legs launched so far, the pending one included
    uint8[4] route; // body per leg, NO_BODY when unused
    uint16[4] rolls; // VRF roll in [0, 9999] per resolved leg
    uint256 payout; // final payout once settled, else 0
  }

  // ---------------------------------------------------------------------------
  // Paytable
  // ---------------------------------------------------------------------------

  /// @notice Survival threshold: a leg survives when roll < surviveBps(body).
  function surviveBps(uint8 body) public pure returns (uint16) {
    if (body == MOON) return 8_000;
    if (body == JUPITER) return 5_000;
    if (body == PULSAR) return 2_500;
    if (body == BLACK_HOLE) return 1_250;
    if (body == COMET) return 9_000;
    if (body == NEPTUNE) return 7_500;
    if (body == SATURN) return 6_250;
    if (body == RED_GIANT) return 4_000;
    revert GravitySlingshot__InvalidBody(body);
  }

  /// @notice Leg multiplier as an exact fraction num / den (surviveBps * num == 10_000 * den).
  function legMultiplier(uint8 body) public pure returns (uint256 num, uint256 den) {
    if (body == MOON) return (5, 4);
    if (body == JUPITER) return (2, 1);
    if (body == PULSAR) return (4, 1);
    if (body == BLACK_HOLE) return (8, 1);
    if (body == COMET) return (10, 9);
    if (body == NEPTUNE) return (4, 3);
    if (body == SATURN) return (8, 5);
    if (body == RED_GIANT) return (5, 2);
    revert GravitySlingshot__InvalidBody(body);
  }

  /// @notice Product of the first `legs` leg multipliers, as an exact fraction.
  function routeMultiplier(
    uint8[4] memory route,
    uint8 legs
  ) public pure returns (uint256 num, uint256 den) {
    require(legs <= MAX_LEGS, "Route longer than tour");
    num = 1;
    den = 1;
    for (uint8 i = 0; i < legs; i++) {
      (uint256 n, uint256 d) = legMultiplier(route[i]);
      num *= n;
      den *= d;
    }
    assert(num >= den); // every leg multiplier is >= 1
  }

  /// @notice The single payout function behind caps, risk, eject, completion and forfeit.
  /// @dev One division, rounding down, so no route can pay above the committed reserve.
  function tourPayout(
    uint256 wager,
    uint8[4] memory route,
    uint8 legs
  ) public pure returns (uint256) {
    require(legs >= 1, "Tour has no legs");
    (uint256 num, uint256 den) = routeMultiplier(route, legs);
    return (wager * num * RTP_BPS) / (den * BASIS_POINTS);
  }

  /// @notice Highest-paying legal route for a given first body (verified by enumeration in tests).
  function topRoute(uint8 firstBody) public pure returns (uint8[4] memory route) {
    if (firstBody == BLACK_HOLE) return [BLACK_HOLE, PULSAR, BLACK_HOLE, PULSAR]; // 1024x
    if (firstBody >= BODY_COUNT) revert GravitySlingshot__InvalidBody(firstBody);
    // Every other first body continues Black hole, Pulsar, Black hole: 256x times its own leg
    // (Comet 284.4x, Moon 320x, Neptune 341.3x, Saturn 409.6x, Jupiter 512x, Red giant 640x,
    // Pulsar 1024x).
    return [firstBody, BLACK_HOLE, PULSAR, BLACK_HOLE];
  }

  /// @notice Upper bound (rounded up) on the route multiplier, which equals E[M^2] for a fixed
  ///         route, among routes that never pay the top tier. Found by enumeration in tests.
  function nonTopSecondMoment(uint8 firstBody) public pure returns (uint256) {
    if (firstBody == COMET) return 178; // 177.78: Comet, Black hole, Red giant, Black hole
    if (firstBody == MOON) return 200;
    if (firstBody == NEPTUNE) return 214; // 213.33
    if (firstBody == SATURN) return 256;
    if (firstBody == JUPITER) return 320;
    if (firstBody == RED_GIANT) return 400;
    if (firstBody == PULSAR || firstBody == BLACK_HOLE) return 640;
    revert GravitySlingshot__InvalidBody(firstBody);
  }

  function maxPayout(uint256 wager, uint8 firstBody) public pure returns (uint256 payout) {
    if (wager == 0) revert GravitySlingshot__InvalidWager(wager);
    payout = tourPayout(wager, topRoute(firstBody), MAX_LEGS);
    require(payout > wager, "Top route must pay above stake");
  }

  // ---------------------------------------------------------------------------
  // Encoding
  // ---------------------------------------------------------------------------

  /// @notice gameData = abi.encode(uint8 firstBody). Opening a session launches leg 1.
  function decodeGameData(bytes calldata gameData) public pure returns (uint8 firstBody) {
    if (gameData.length != 32) revert GravitySlingshot__InvalidGameData();
    firstBody = abi.decode(gameData, (uint8));
    if (firstBody >= BODY_COUNT) revert GravitySlingshot__InvalidBody(firstBody);
  }

  function decodeTour(bytes memory state) public pure returns (Tour memory tour) {
    if (state.length != TOUR_STATE_BYTES) revert GravitySlingshot__InvalidTourState();
    (tour.status, tour.legs, tour.route, tour.rolls, tour.payout) = abi.decode(
      state,
      (uint8, uint8, uint8[4], uint16[4], uint256)
    );
    if (tour.legs == 0 || tour.legs > MAX_LEGS) revert GravitySlingshot__InvalidTourState();
    if (tour.status > STATUS_COMPLETE) revert GravitySlingshot__InvalidTourState();
  }

  function _encodeTour(Tour memory tour) internal pure returns (bytes memory state) {
    state = abi.encode(tour.status, tour.legs, tour.route, tour.rolls, tour.payout);
    assert(state.length == TOUR_STATE_BYTES);
  }

  // ---------------------------------------------------------------------------
  // Quotes
  // ---------------------------------------------------------------------------

  function quoteCaps(
    uint256 wager,
    bytes calldata gameData
  ) external pure override returns (uint256 maxEscrowStake, uint256 maxReservedProfit) {
    uint8 firstBody = decodeGameData(gameData);
    maxEscrowStake = wager;
    maxReservedProfit = maxPayout(wager, firstBody) - wager;
  }

  /**
   * @dev Risk inputs, all bounded over every strategy:
   *  - maxPayout / probabilityWad: the top route. Legs are fair, so P(top) = 1 / multiplier.
   *  - bodyVarianceScaled: variance per unit wager is 0.93^2 * (E[M^2] - 1), and for a
   *    fixed route E[M^2] = product of its leg multipliers. The largest product among
   *    routes that never pay the top tier is nonTopSecondMoment(firstBody). The binary
   *    top-tier term alone already bounds the total variance.
   */
  function quoteRiskParams(
    uint256 wager,
    bytes calldata gameData
  )
    external
    pure
    override
    returns (
      uint256 maxPayout_,
      uint256 probabilityWad,
      uint256 expectedPayout,
      uint256 bodyVarianceScaled
    )
  {
    uint8 firstBody = decodeGameData(gameData);
    maxPayout_ = maxPayout(wager, firstBody);
    (uint256 num, uint256 den) = routeMultiplier(topRoute(firstBody), MAX_LEGS);
    probabilityWad = (den * WAD + num - 1) / num; // ceil(1 / multiplier)
    expectedPayout = (wager * RTP_BPS) / BASIS_POINTS;
    uint256 secondMoment = nonTopSecondMoment(firstBody);
    uint256 bodyVarianceWad = (RTP_BPS * RTP_BPS * (secondMoment - 1) * WAD) /
      (BASIS_POINTS * BASIS_POINTS);
    bodyVarianceScaled = wager * wager * bodyVarianceWad;
  }

  /// @notice Anytime cash-out value: the eject payout while cruising, 0 while a leg is in flight.
  /// @dev Fully determined by revealed state, and the facet pays 90% of it on forfeit,
  ///      which is always worse for the player than ejecting.
  function quoteForfeitPayout(SessionContext calldata ctx) external pure override returns (uint256) {
    if (ctx.gameState.length != TOUR_STATE_BYTES) return 0;
    Tour memory tour = decodeTour(ctx.gameState);
    if (tour.status != STATUS_CRUISING) return 0;
    return tourPayout(ctx.wagerBase, tour.route, tour.legs);
  }

  // ---------------------------------------------------------------------------
  // Session steps
  // ---------------------------------------------------------------------------

  /// @notice Opens the tour and launches leg 1 around the body chosen in gameData.
  function onSessionStart(
    SessionContext calldata ctx
  ) external pure override returns (StepResult memory result) {
    uint8 firstBody = decodeGameData(ctx.gameData);
    uint256 reserve = maxPayout(ctx.wagerBase, firstBody) - ctx.wagerBase;

    Tour memory tour = _newTour();
    tour.status = STATUS_BURNING;
    tour.legs = 1;
    tour.route[0] = firstBody;

    result.newGameState = _encodeTour(tour);
    result.reservedProfitDelta = int256(reserve);
    result.nextPhase = SessionPhase.WAITING_RANDOMNESS;
    result.requestRandomnessNow = true;
  }

  /// @notice actionData = abi.encode(uint8 action, uint8 body). EJECT ignores body.
  function onPlayerAction(
    SessionContext calldata ctx,
    bytes calldata actionData
  ) external pure override returns (StepResult memory result) {
    Tour memory tour = decodeTour(ctx.gameState);
    if (tour.status != STATUS_CRUISING) revert GravitySlingshot__NotCruising(tour.status);
    require(actionData.length == 64, "Invalid actionData length");
    (uint8 action, uint8 body) = abi.decode(actionData, (uint8, uint8));

    if (action == ACTION_EJECT) return _settle(ctx.wagerBase, tour, STATUS_EJECTED);
    if (action != ACTION_LAUNCH) revert GravitySlingshot__InvalidAction(action);

    _checkLaunch(tour, body);
    tour.route[tour.legs] = body;
    tour.legs += 1;
    tour.status = STATUS_BURNING;

    result.newGameState = _encodeTour(tour);
    result.nextPhase = SessionPhase.WAITING_RANDOMNESS;
    result.requestRandomnessNow = true;
  }

  function onRandomness(
    SessionContext calldata ctx,
    bytes32 randomness
  ) external pure override returns (StepResult memory result) {
    Tour memory tour = decodeTour(ctx.gameState);
    if (tour.status != STATUS_BURNING) revert GravitySlingshot__NotBurning(tour.status);

    uint8 leg = tour.legs - 1;
    uint16 roll = _drawUniformBps(randomness);
    tour.rolls[leg] = roll;

    if (roll >= surviveBps(tour.route[leg])) {
      tour.status = STATUS_CAPTURED;
      result.newGameState = _encodeTour(tour);
      result.nextPhase = SessionPhase.SETTLED;
      return result; // payout 0; the facet releases escrow and reserve itself
    }
    if (tour.legs == MAX_LEGS) return _settle(ctx.wagerBase, tour, STATUS_COMPLETE);

    tour.status = STATUS_CRUISING;
    result.newGameState = _encodeTour(tour);
    result.nextPhase = SessionPhase.WAITING_PLAYER_ACTION;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  function _newTour() internal pure returns (Tour memory tour) {
    tour.route = [NO_BODY, NO_BODY, NO_BODY, NO_BODY];
  }

  function _checkLaunch(Tour memory tour, uint8 body) internal pure {
    if (tour.legs >= MAX_LEGS) revert GravitySlingshot__TourComplete();
    if (body >= BODY_COUNT) revert GravitySlingshot__InvalidBody(body);
    if (body == tour.route[tour.legs - 1]) revert GravitySlingshot__RepeatBody(body);
  }

  /// @dev Settling steps return zero escrow and reserve deltas: the facet caps the payout at
  ///      escrowedStake + reservedProfit and releases both itself after this step.
  function _settle(
    uint256 wager,
    Tour memory tour,
    uint8 status
  ) internal pure returns (StepResult memory result) {
    uint256 payout = tourPayout(wager, tour.route, tour.legs);
    assert(payout <= maxPayout(wager, tour.route[0]));
    tour.status = status;
    tour.payout = payout;
    result.newGameState = _encodeTour(tour);
    result.nextPhase = SessionPhase.SETTLED;
    result.payout = payout;
  }

  /// @dev Unbiased roll in [0, 9999] by rejection sampling (no modulo bias).
  function _drawUniformBps(bytes32 seed) internal pure returns (uint16 rollBps) {
    uint256 sample = uint256(seed);
    uint256 limit = type(uint256).max - (type(uint256).max % BASIS_POINTS);
    for (uint256 attempt = 0; attempt < MAX_REHASH_ATTEMPTS; attempt++) {
      if (sample < limit) {
        rollBps = uint16(sample % BASIS_POINTS);
        assert(rollBps < BASIS_POINTS);
        return rollBps;
      }
      sample = uint256(keccak256(abi.encodePacked(seed, attempt)));
    }
    revert GravitySlingshot__EntropyExhausted();
  }
}
