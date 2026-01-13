import { Navigate, Route, Routes } from 'react-router-dom';

import Dashboard from '@/pages/Dashboard';
import Account from '@/pages/Account';
import Faucet from '@/pages/Faucet';
import Transfer from '@/pages/Transfer';
import AcceptPayment from '@/pages/AcceptPayment';
import Tokens from '@/pages/Tokens';
import TokensLayout from '@/pages/Tokens/Layout';
import DEX from '@/pages/DEX';
import Contracts from '@/pages/Contracts';
import Liquidity from '@/pages/Liquidity';
import IssuanceLayout from '@/pages/Issuance/Layout';
import IssuanceCreate from '@/pages/Issuance/Create';
import IssuanceMint from '@/pages/Issuance/Mint';
import IssuanceFees from '@/pages/Issuance/Fees';
import IssuanceRewards from '@/pages/Issuance/Rewards';
import IssuanceManage from '@/pages/Issuance/Manage';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/account" element={<Account />} />
      <Route path="/faucet" element={<Faucet />} />
      <Route path="/transfer" element={<Transfer />} />
      <Route path="/payments/accept" element={<AcceptPayment />} />
      <Route path="/tokens" element={<TokensLayout />}>
        <Route index element={<Tokens />} />
        <Route path="create" element={<Navigate to="/issuance/create" replace />} />
      </Route>
      <Route path="/dex" element={<DEX />} />
      <Route path="/dex/liquidity" element={<Liquidity />} />
      <Route path="/issuance" element={<IssuanceLayout />}>
        <Route index element={<Navigate to="/issuance/create" replace />} />
        <Route path="create" element={<IssuanceCreate />} />
        <Route path="mint" element={<IssuanceMint />} />
        <Route path="fees" element={<IssuanceFees />} />
        <Route path="rewards" element={<IssuanceRewards />} />
        <Route path="manage" element={<IssuanceManage />} />
      </Route>
      <Route path="/contracts" element={<Contracts />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
