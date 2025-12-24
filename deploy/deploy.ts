import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  if (hre.network.name === "sepolia") {
    if (!process.env.PRIVATE_KEY) {
      throw new Error("Missing PRIVATE_KEY for Sepolia deployment");
    }
    if (!process.env.INFURA_API_KEY) {
      throw new Error("Missing INFURA_API_KEY for Sepolia deployment");
    }
  }

  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedFHECounter = await deploy("FHECounter", {
    from: deployer,
    log: true,
  });

  const deployedSecretUSDT = await deploy("SecretUSDT", {
    from: deployer,
    log: true,
  });

  const deployedSecretFi = await deploy("SecretFi", {
    from: deployer,
    log: true,
    args: [deployedSecretUSDT.address],
  });

  const signer = await hre.ethers.getSigner(deployer);
  const secretUsdt = await hre.ethers.getContractAt("SecretUSDT", deployedSecretUSDT.address, signer);
  const currentMinter = await secretUsdt.minter();
  if (currentMinter.toLowerCase() !== deployedSecretFi.address.toLowerCase()) {
    const tx = await secretUsdt.setMinter(deployedSecretFi.address);
    await tx.wait();
  }

  console.log(`FHECounter contract: `, deployedFHECounter.address);
  console.log(`SecretUSDT contract: `, deployedSecretUSDT.address);
  console.log(`SecretFi contract: `, deployedSecretFi.address);
};
export default func;
func.id = "deploy_secretfi"; // id required to prevent reexecution
func.tags = ["FHECounter", "SecretUSDT", "SecretFi"];
