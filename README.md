# SecretFi

SecretFi is a confidential staking and borrowing protocol built on FHEVM. Users stake ETH, borrow sUSDT, repay debt,
and withdraw ETH while their position data stays encrypted on-chain. The protocol uses Fully Homomorphic Encryption
(FHE) via Zama to enforce collateral rules without revealing balances publicly.

## Table of Contents

- Overview
- Key Advantages
- Problems Solved
- How It Works
- Architecture
- Tech Stack
- Repository Layout
- Setup and Usage
- Frontend Integration
- Security Notes and Limitations
- Future Plans
- License

## Overview

SecretFi provides a simple DeFi loop with strong privacy properties:

- Stake ETH and keep the stake amount encrypted as an euint64.
- Borrow sUSDT against encrypted collateral with a fixed 50% loan-to-value rule.
- Repay sUSDT to reduce encrypted debt.
- Request a withdrawal and finalize it after public decryption.

Unlike typical DeFi vaults that publish user balances, SecretFi keeps stake, debt, and token balances encrypted on-chain,
only revealing clear values when required for withdrawals.

## Key Advantages

- Confidential positions: stake, debt, and token balances are stored as ciphertexts.
- On-chain enforcement: collateral limits are enforced on-chain using FHE.
- Minimal disclosure: users only reveal a clear amount when finalizing withdrawals.
- Local decryption: users can decrypt their position in the frontend without exposing it publicly.
- Simple risk model: a fixed 50% LTV makes limits predictable.

## Problems Solved

- Public DeFi vaults expose positions and borrowing capacity, enabling wallet profiling and targeted liquidation.
- Privacy and collateral enforcement are typically a tradeoff; SecretFi uses FHE to keep both.
- Borrowers do not need to trust a centralized custodian to keep positions private.

## How It Works

1. Stake ETH
   - User sends ETH to the SecretFi contract.
   - The stake is stored as an encrypted euint64.
2. Borrow sUSDT
   - User submits an encrypted borrow amount.
   - SecretFi enforces a 50% LTV: maxBorrow = stake / 2 - currentDebt.
   - SecretFi mints encrypted sUSDT through SecretUSDT.
3. Repay sUSDT
   - User submits an encrypted repay amount.
   - SecretFi burns sUSDT and decreases encrypted debt.
4. Withdraw ETH
   - User requests a withdraw with an encrypted amount.
   - The ciphertext is marked publicly decryptable.
   - User finalizes withdrawal with the clear amount and decryption proof.

## Architecture

### Smart Contracts

- `SecretFi`: Core protocol that manages encrypted stakes, debts, and withdrawals.
  - Enforces LTV with encrypted math and `BORROW_DIVISOR = 2`.
  - Supports withdrawal requests and finalization with decryption proofs.
- `SecretUSDT`: Confidential ERC7984 token for minted debt.
  - Mint/burn restricted to the SecretFi contract.
- `FHECounter`: Example FHE contract kept for reference and testing.

### Frontend

- React + Vite UI for staking, borrowing, repaying, and withdrawals.
- Reads encrypted handles with viem.
- Writes transactions with ethers.
- Uses the Zama relayer to encrypt inputs and decrypt user data locally.

## Tech Stack

- Solidity 0.8.27
- Zama FHEVM libraries and relayer
- Hardhat + hardhat-deploy
- OpenZeppelin confidential contracts (ERC7984)
- TypeScript
- React + Vite
- wagmi + RainbowKit
- viem (read) + ethers v6 (write)

## Repository Layout

```
secretfi/
├── contracts/           # SecretFi and SecretUSDT contracts
├── deploy/              # Deployment script
├── tasks/               # Hardhat tasks
├── test/                # Hardhat tests
├── app/                 # React frontend
└── hardhat.config.ts    # Hardhat configuration
```

## Setup and Usage

### Prerequisites

- Node.js 20+
- npm

### Install dependencies

```bash
npm install
```

### Compile and test

```bash
npm run compile
npm run test
```

### Local deployment (development)

```bash
npx hardhat node
npx hardhat deploy --network localhost
```

### Sepolia deployment

Create a `.env` file in the repository root:

```
INFURA_API_KEY=your_infura_key
PRIVATE_KEY=0x...
ETHERSCAN_API_KEY=optional
```

Deploy:

```bash
npx hardhat deploy --network sepolia
```

### Hardhat tasks (example)

```bash
npx hardhat --network sepolia task:address
npx hardhat --network sepolia task:decrypt-count
```

## Frontend Integration

The frontend is in `app/` and does not use environment variables. To connect it:

1. Deploy contracts to Sepolia.
2. Copy addresses and ABIs from `deployments/sepolia`.
3. Update `app/src/config/contracts.ts`:
   - Set `SECRET_FI_ADDRESS` and `SUSDT_ADDRESS`.
   - Replace the ABI arrays with the generated ABIs.

Run the frontend:

```bash
cd app
npm install
npm run dev
```

## Security Notes and Limitations

- Borrowing uses a fixed 50% LTV; there is no dynamic risk model or oracle.
- There is no liquidation engine in the current version.
- Amounts are stored as `euint64`; inputs above the limit are rejected.
- Withdrawal requires public decryption and proof verification.
- This codebase has not been audited.

## Future Plans

- Add price oracle support and dynamic LTV rules.
- Implement liquidation and health factor monitoring.
- Support multiple collateral types and stable assets.
- Improve withdrawal UX and request tracking.
- Expand tests for SecretFi and SecretUSDT flows.
- Prepare the protocol for external audits.

## License

BSD-3-Clause-Clear. See `LICENSE`.
