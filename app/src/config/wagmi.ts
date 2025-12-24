import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia } from 'wagmi/chains';

export const config = getDefaultConfig({
  appName: 'SecretFi',
  projectId: 'REPLACE_WITH_PROJECT_ID',
  chains: [sepolia],
  ssr: false,
});
