import { useMemo, useState } from 'react';
import { Contract, Interface, formatUnits, parseUnits } from 'ethers';
import { useAccount, useReadContract } from 'wagmi';
import { useEthersSigner } from '../hooks/useEthersSigner';
import { useZamaInstance } from '../hooks/useZamaInstance';
import { SECRET_FI_ADDRESS, SECRET_FI_ABI, SUSDT_ADDRESS, SUSDT_ABI } from '../config/contracts';
import { Header } from './Header';
import '../styles/SecretFiApp.css';

const MAX_UINT64 = (1n << 64n) - 1n;
const BORROW_DIVISOR = 2n;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_HANDLE = `0x${'0'.repeat(64)}`;

type DecryptedPosition = {
  stake?: bigint;
  debt?: bigint;
  susdt?: bigint;
};

export function SecretFiApp() {
  const { address, isConnected } = useAccount();
  const signerPromise = useEthersSigner();
  const { instance, isLoading: zamaLoading } = useZamaInstance();
  const contractsReady = SECRET_FI_ADDRESS.toLowerCase() !== ZERO_ADDRESS
    && SUSDT_ADDRESS.toLowerCase() !== ZERO_ADDRESS;

  const [stakeInput, setStakeInput] = useState('');
  const [borrowInput, setBorrowInput] = useState('');
  const [repayInput, setRepayInput] = useState('');
  const [withdrawInput, setWithdrawInput] = useState('');
  const [requestIdInput, setRequestIdInput] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [decrypted, setDecrypted] = useState<DecryptedPosition>({});

  const { data: stakeHandle } = useReadContract({
    address: SECRET_FI_ADDRESS,
    abi: SECRET_FI_ABI,
    functionName: 'getStake',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && contractsReady,
    },
  });

  const { data: debtHandle } = useReadContract({
    address: SECRET_FI_ADDRESS,
    abi: SECRET_FI_ABI,
    functionName: 'getDebt',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && contractsReady,
    },
  });

  const { data: susdtHandle } = useReadContract({
    address: SUSDT_ADDRESS,
    abi: SUSDT_ABI,
    functionName: 'confidentialBalanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && contractsReady,
    },
  });

  const parsedRequestId = useMemo(() => {
    if (!requestIdInput.trim()) {
      return null;
    }
    try {
      const value = BigInt(requestIdInput);
      return value > 0n ? value : null;
    } catch {
      return null;
    }
  }, [requestIdInput]);

  const { data: withdrawRequest } = useReadContract({
    address: SECRET_FI_ADDRESS,
    abi: SECRET_FI_ABI,
    functionName: 'getWithdrawRequest',
    args: parsedRequestId ? [parsedRequestId] : undefined,
    query: {
      enabled: !!parsedRequestId && contractsReady,
    },
  });

  const availableBorrow = useMemo(() => {
    if (decrypted.stake === undefined || decrypted.debt === undefined) {
      return undefined;
    }
    const maxBorrow = decrypted.stake / BORROW_DIVISOR;
    return maxBorrow > decrypted.debt ? maxBorrow - decrypted.debt : 0n;
  }, [decrypted.debt, decrypted.stake]);

  const withdrawable = useMemo(() => {
    if (decrypted.stake === undefined || decrypted.debt === undefined) {
      return undefined;
    }
    const required = decrypted.debt * BORROW_DIVISOR;
    return decrypted.stake > required ? decrypted.stake - required : 0n;
  }, [decrypted.debt, decrypted.stake]);

  const stakeHandleString = stakeHandle as `0x${string}` | undefined;
  const debtHandleString = debtHandle as `0x${string}` | undefined;
  const susdtHandleString = susdtHandle as `0x${string}` | undefined;

  const withdrawRequestData = withdrawRequest as readonly [string, `0x${string}`] | undefined;
  const withdrawRecipient = withdrawRequestData?.[0];
  const withdrawHandle = withdrawRequestData?.[1];

  const formatAmount = (value?: bigint) => {
    if (value === undefined) {
      return '-';
    }
    const formatted = formatUnits(value, 18);
    const [whole, fraction = ''] = formatted.split('.');
    const trimmedFraction = fraction.slice(0, 4).replace(/0+$/, '');
    return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
  };

  const parseAmount = (rawValue: string) => {
    if (!rawValue.trim()) {
      throw new Error('Enter an amount.');
    }
    const parsed = parseUnits(rawValue, 18);
    if (parsed <= 0n) {
      throw new Error('Amount must be greater than 0.');
    }
    if (parsed > MAX_UINT64) {
      throw new Error('Amount exceeds the encrypted limit.');
    }
    return parsed;
  };

  const encryptAmount = async (amount: bigint) => {
    if (!instance || !address) {
      throw new Error('Encryption service is not ready.');
    }
    if (!contractsReady) {
      throw new Error('Contract addresses are not configured.');
    }
    const input = instance.createEncryptedInput(SECRET_FI_ADDRESS, address);
    input.add64(amount);
    return input.encrypt();
  };

  const getSigner = async () => {
    if (!signerPromise) {
      throw new Error('Wallet is not connected.');
    }
    const signer = await signerPromise;
    if (!signer) {
      throw new Error('Signer is not available.');
    }
    return signer;
  };

  const runAction = async (label: string, action: () => Promise<void>, successMessage?: string) => {
    setActionNotice('');
    setBusyAction(label);
    try {
      if (!contractsReady) {
        throw new Error('Contract addresses are not configured.');
      }
      await action();
      setActionNotice(successMessage ?? `${label} confirmed on-chain.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error';
      setActionNotice(message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleStake = () => runAction('Stake', async () => {
    const amount = parseAmount(stakeInput);
    const signer = await getSigner();
    const contract = new Contract(SECRET_FI_ADDRESS, SECRET_FI_ABI, signer);
    const tx = await contract.stake({ value: amount });
    await tx.wait();
    setStakeInput('');
  });

  const handleBorrow = () => runAction('Borrow', async () => {
    const amount = parseAmount(borrowInput);
    const encrypted = await encryptAmount(amount);
    const signer = await getSigner();
    const contract = new Contract(SECRET_FI_ADDRESS, SECRET_FI_ABI, signer);
    const tx = await contract.borrow(encrypted.handles[0], encrypted.inputProof);
    await tx.wait();
    setBorrowInput('');
  });

  const handleRepay = () => runAction('Repay', async () => {
    const amount = parseAmount(repayInput);
    const encrypted = await encryptAmount(amount);
    const signer = await getSigner();
    const contract = new Contract(SECRET_FI_ADDRESS, SECRET_FI_ABI, signer);
    const tx = await contract.repay(encrypted.handles[0], encrypted.inputProof);
    await tx.wait();
    setRepayInput('');
  });

  const handleRequestWithdraw = () => runAction('Request Withdraw', async () => {
    const amount = parseAmount(withdrawInput);
    const encrypted = await encryptAmount(amount);
    const signer = await getSigner();
    const contract = new Contract(SECRET_FI_ADDRESS, SECRET_FI_ABI, signer);
    const tx = await contract.requestWithdraw(encrypted.handles[0], encrypted.inputProof);
    const receipt = await tx.wait();
    const iface = new Interface(SECRET_FI_ABI);
    const withdrawEvent = iface.getEvent('WithdrawRequested');
    if (!withdrawEvent) {
      throw new Error('Withdraw event ABI missing.');
    }
    const event = receipt?.logs.find((log: { address: string; topics: string[] }) => {
      return log.address.toLowerCase() === SECRET_FI_ADDRESS.toLowerCase()
        && log.topics[0] === withdrawEvent.topicHash;
    });
    if (event) {
      const parsed = iface.parseLog(event);
      if (!parsed) {
        throw new Error('Failed to parse withdraw event.');
      }
      setRequestIdInput(parsed.args.requestId.toString());
    }
    setWithdrawInput('');
  });

  const handleFinalizeWithdraw = () => runAction('Finalize Withdraw', async () => {
    if (!parsedRequestId || !withdrawHandle) {
      throw new Error('Provide a valid request id first.');
    }
    if (!instance) {
      throw new Error('Encryption service is not ready.');
    }
    const decryptResult = await instance.publicDecrypt([withdrawHandle]);
    const clearValues = decryptResult.clearValues as Record<string, bigint>;
    const clearAmount = clearValues[withdrawHandle];
    if (clearAmount === undefined) {
      throw new Error('Failed to decrypt withdraw amount.');
    }
    const signer = await getSigner();
    const contract = new Contract(SECRET_FI_ADDRESS, SECRET_FI_ABI, signer);
    const tx = await contract.finalizeWithdraw(parsedRequestId, clearAmount, decryptResult.decryptionProof);
    await tx.wait();
  });

  const handleDecryptPosition = () => runAction('Decrypt', async () => {
    if (!instance || !address) {
      throw new Error('Wallet connection and encryption service are required.');
    }
    if (!contractsReady) {
      throw new Error('Contract addresses are not configured.');
    }

    const handlePairs: { handle: string; contractAddress: string }[] = [];
    const contracts = new Set<string>();

    if (stakeHandleString && stakeHandleString !== ZERO_HANDLE) {
      handlePairs.push({ handle: stakeHandleString, contractAddress: SECRET_FI_ADDRESS });
      contracts.add(SECRET_FI_ADDRESS);
    }
    if (debtHandleString && debtHandleString !== ZERO_HANDLE) {
      handlePairs.push({ handle: debtHandleString, contractAddress: SECRET_FI_ADDRESS });
      contracts.add(SECRET_FI_ADDRESS);
    }
    if (susdtHandleString && susdtHandleString !== ZERO_HANDLE) {
      handlePairs.push({ handle: susdtHandleString, contractAddress: SUSDT_ADDRESS });
      contracts.add(SUSDT_ADDRESS);
    }

    if (handlePairs.length === 0) {
      throw new Error('No encrypted data available to decrypt.');
    }

    const keypair = instance.generateKeypair();
    const contractAddresses = Array.from(contracts);
    const startTimeStamp = Math.floor(Date.now() / 1000).toString();
    const durationDays = '10';
    const eip712 = instance.createEIP712(
      keypair.publicKey,
      contractAddresses,
      startTimeStamp,
      durationDays,
    );

    const signer = await getSigner();
    const signature = await signer.signTypedData(
      eip712.domain,
      {
        UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification,
      },
      eip712.message,
    );

    const result = await instance.userDecrypt(
      handlePairs,
      keypair.privateKey,
      keypair.publicKey,
      signature.replace('0x', ''),
      contractAddresses,
      address,
      startTimeStamp,
      durationDays,
    );

    const toBigInt = (value: unknown) => (typeof value === 'bigint' ? value : BigInt(value as string));

    setDecrypted({
      stake: stakeHandleString && result[stakeHandleString] !== undefined ? toBigInt(result[stakeHandleString]) : undefined,
      debt: debtHandleString && result[debtHandleString] !== undefined ? toBigInt(result[debtHandleString]) : undefined,
      susdt: susdtHandleString && result[susdtHandleString] !== undefined ? toBigInt(result[susdtHandleString]) : undefined,
    });
  }, 'Decryption completed.');

  return (
    <div className="secretfi-app">
      <Header />
      <section className="hero">
        <div className="hero-content">
          <div className="hero-pill">Encrypted staking and borrowing on Sepolia</div>
          <h2 className="hero-title">SecretFi Vault</h2>
          <p className="hero-subtitle">
            Stake ETH, borrow sUSDT, and keep position data encrypted with FHE. Your balances stay private while the
            protocol enforces collateral safety.
          </p>
          <div className="hero-grid">
            <div className="hero-stat">
              <span className="hero-stat-label">Encrypted stake</span>
              <span className="hero-stat-value">{stakeHandleString && stakeHandleString !== ZERO_HANDLE ? '***' : '-'}</span>
            </div>
            <div className="hero-stat">
              <span className="hero-stat-label">Encrypted debt</span>
              <span className="hero-stat-value">{debtHandleString && debtHandleString !== ZERO_HANDLE ? '***' : '-'}</span>
            </div>
            <div className="hero-stat">
              <span className="hero-stat-label">sUSDT balance</span>
              <span className="hero-stat-value">{susdtHandleString && susdtHandleString !== ZERO_HANDLE ? '***' : '-'}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="content-grid">
        <div className="actions-column">
          <div className="card">
            <h3 className="card-title">Stake ETH</h3>
            <p className="card-subtitle">Deposit ETH to open encrypted collateral.</p>
            <div className="input-row">
              <input
                value={stakeInput}
                onChange={(event) => setStakeInput(event.target.value)}
                placeholder="0.0"
                inputMode="decimal"
                className="amount-input"
              />
              <button
                onClick={handleStake}
                disabled={!isConnected || !contractsReady || busyAction === 'Stake'}
                className="primary-button"
              >
                {busyAction === 'Stake' ? 'Staking...' : 'Stake'}
              </button>
            </div>
          </div>

          <div className="card">
            <h3 className="card-title">Borrow sUSDT</h3>
            <p className="card-subtitle">Mint encrypted stablecoins against your stake.</p>
            <div className="input-row">
              <input
                value={borrowInput}
                onChange={(event) => setBorrowInput(event.target.value)}
                placeholder="0.0"
                inputMode="decimal"
                className="amount-input"
              />
              <button
                onClick={handleBorrow}
                disabled={!isConnected || !contractsReady || busyAction === 'Borrow' || zamaLoading}
                className="primary-button"
              >
                {busyAction === 'Borrow' ? 'Borrowing...' : zamaLoading ? 'Encrypting...' : 'Borrow'}
              </button>
            </div>
          </div>

          <div className="card">
            <h3 className="card-title">Repay sUSDT</h3>
            <p className="card-subtitle">Burn sUSDT to reduce your encrypted debt.</p>
            <div className="input-row">
              <input
                value={repayInput}
                onChange={(event) => setRepayInput(event.target.value)}
                placeholder="0.0"
                inputMode="decimal"
                className="amount-input"
              />
              <button
                onClick={handleRepay}
                disabled={!isConnected || !contractsReady || busyAction === 'Repay' || zamaLoading}
                className="primary-button"
              >
                {busyAction === 'Repay' ? 'Repaying...' : zamaLoading ? 'Encrypting...' : 'Repay'}
              </button>
            </div>
          </div>

          <div className="card">
            <h3 className="card-title">Withdraw ETH</h3>
            <p className="card-subtitle">Request a withdrawal and finalize it after public decryption.</p>
            <div className="input-row">
              <input
                value={withdrawInput}
                onChange={(event) => setWithdrawInput(event.target.value)}
                placeholder="0.0"
                inputMode="decimal"
                className="amount-input"
              />
              <button
                onClick={handleRequestWithdraw}
                disabled={!isConnected || !contractsReady || busyAction === 'Request Withdraw' || zamaLoading}
                className="primary-button"
              >
                {busyAction === 'Request Withdraw' ? 'Requesting...' : zamaLoading ? 'Encrypting...' : 'Request'}
              </button>
            </div>
            <div className="request-row">
              <input
                value={requestIdInput}
                onChange={(event) => setRequestIdInput(event.target.value)}
                placeholder="Request id"
                inputMode="numeric"
                className="request-input"
              />
              <button
                onClick={handleFinalizeWithdraw}
                disabled={!isConnected || !contractsReady || busyAction === 'Finalize Withdraw' || !parsedRequestId || zamaLoading}
                className="ghost-button"
              >
                {busyAction === 'Finalize Withdraw' ? 'Finalizing...' : 'Finalize'}
              </button>
            </div>
            {withdrawRecipient && withdrawRecipient !== ZERO_ADDRESS && withdrawHandle ? (
              <div className="request-details">
                <span>Recipient: {withdrawRecipient.slice(0, 6)}...{withdrawRecipient.slice(-4)}</span>
                <span>Handle: {withdrawHandle.slice(0, 10)}...</span>
              </div>
            ) : (
              <p className="request-hint">Enter a request id to load the withdrawal handle.</p>
            )}
          </div>
        </div>

        <div className="status-column">
          <div className="card highlight-card">
            <h3 className="card-title">Encrypted Position</h3>
            <p className="card-subtitle">Decrypt balances locally to view your position.</p>
            <div className="position-grid">
              <div>
                <span className="stat-label">Stake (ETH)</span>
                <span className="stat-value">{formatAmount(decrypted.stake)}</span>
              </div>
              <div>
                <span className="stat-label">Debt (sUSDT)</span>
                <span className="stat-value">{formatAmount(decrypted.debt)}</span>
              </div>
              <div>
                <span className="stat-label">sUSDT Balance</span>
                <span className="stat-value">{formatAmount(decrypted.susdt)}</span>
              </div>
              <div>
                <span className="stat-label">Borrowable</span>
                <span className="stat-value">{formatAmount(availableBorrow)}</span>
              </div>
              <div>
                <span className="stat-label">Withdrawable</span>
                <span className="stat-value">{formatAmount(withdrawable)}</span>
              </div>
            </div>
            <button
              onClick={handleDecryptPosition}
              disabled={!isConnected || !contractsReady || busyAction === 'Decrypt' || zamaLoading}
              className="primary-button full-width"
            >
              {busyAction === 'Decrypt' ? 'Decrypting...' : zamaLoading ? 'Preparing encryption...' : 'Decrypt my data'}
            </button>
          </div>

          <div className="card">
            <h3 className="card-title">Status</h3>
            <p className="card-subtitle">Latest action feedback.</p>
            <div className="status-box">
              {!contractsReady ? (
                <span>Set SecretFi and sUSDT addresses in the contract config.</span>
              ) : actionNotice ? (
                <span>{actionNotice}</span>
              ) : (
                <span>Ready to transact. Connect your wallet to begin.</span>
              )}
            </div>
          </div>

          <div className="card info-card">
            <h3 className="card-title">Protocol Notes</h3>
            <ul className="info-list">
              <li>Encrypted values stay on-chain as FHE ciphertexts.</li>
              <li>Borrow limit targets a 50% loan-to-value ratio.</li>
              <li>Withdrawals use public decryption to release ETH.</li>
              <li>Reads are powered by viem, writes by ethers.</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
