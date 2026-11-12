import hre from "hardhat";

async function main() {
  console.log("=== Deploying GravitySlingshot to", hre.network.name, "===");

  const publicClient = await hre.viem.getPublicClient();
  const [deployer] = await hre.viem.getWalletClients();

  if (!deployer) {
    throw new Error(
      "No deployer account configured. Set PRIVATE_KEY in environment variables: export PRIVATE_KEY=0x..."
    );
  }

  const deployerAddress = deployer.account.address;
  console.log("Deployer address:", deployerAddress);

  const balance = await publicClient.getBalance({ address: deployerAddress });
  console.log("Account balance:", Number(balance) / 1e18, "ETH");

  if (balance === 0n && hre.network.name !== "hardhat") {
    throw new Error("Deployer account has 0 ETH. Claim dev credits or fund wallet before deploying.");
  }

  console.log("Broadcasting contract creation transaction...");
  const slingshot = await hre.viem.deployContract("GravitySlingshot");

  console.log("==================================================");
  console.log("GravitySlingshot deployed successfully!");
  console.log("Contract Address:", slingshot.address);
  console.log("Network:", hre.network.name);

  if (hre.network.name === "base") {
    console.log("BaseScan Explorer: https://basescan.org/address/" + slingshot.address);
  } else if (hre.network.name === "baseSepolia") {
    console.log("BaseSepolia Explorer: https://sepolia.basescan.org/address/" + slingshot.address);
  }
  console.log("==================================================");
  console.log("Registration metadata for chain.wtf/dev:");
  console.log(JSON.stringify({
    gameId: "GravitySlingshot",
    name: "Gravity Slingshot: Grand Tour",
    contractAddress: slingshot.address,
    network: hre.network.name,
    standard: "ICasinoGameV2",
    rtp: "93.00%",
    maxMultiplier: "952.32x"
  }, null, 2));
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exitCode = 1;
});
