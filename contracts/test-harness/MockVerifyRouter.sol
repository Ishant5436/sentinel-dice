// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface ILocalCasinoHostCallback {
  function onRandomnessFulfilled(
    bytes32 requestId,
    bytes32 randomness,
    bytes calldata clientData
  ) external;
}

contract MockVerifyRouter {
  uint256 public nextRequestId = 1;
  bytes32 public lastRequestId;
  bytes public lastClientData;
  address public lastCaller;

  event RandomnessRequested(bytes32 indexed requestId, address indexed caller);

  function requestRandomness(bytes calldata clientData) external returns (bytes32 requestId) {
    requestId = bytes32(nextRequestId++);
    lastRequestId = requestId;
    lastClientData = clientData;
    lastCaller = msg.sender;
    emit RandomnessRequested(requestId, msg.sender);
  }

  function fulfill(
    address host,
    bytes32 requestId,
    bytes32 randomness,
    bytes calldata clientData
  ) external {
    ILocalCasinoHostCallback(host).onRandomnessFulfilled(requestId, randomness, clientData);
  }
}
