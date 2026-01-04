import React from "react";

import Endpoint from "../Endpoint";
import ProductTypesContainer from "./ProductTypesContainer";
import {
  transactionsCategories,
  balanceCategories,
  liabilitiesCategories,
  transformConvexTransactionsData,
  transformConvexBalanceData,
  transformConvexLiabilitiesData,
} from "../../dataUtilities";

const Products = () => {
  return (
    <ProductTypesContainer productType="Products">
      <Endpoint
        endpoint="transactions"
        name="Transactions"
        categories={transactionsCategories}
        schema="api.plaid.getTransactionsByUser"
        description="Retrieve transactions from Convex database. Data is synced from Plaid and stored locally."
        transformData={transformConvexTransactionsData}
      />

      <Endpoint
        endpoint="balance"
        name="Accounts & Balances"
        categories={balanceCategories}
        schema="api.plaid.getAccountsByUser"
        description="Retrieve account information and balances from Convex database."
        transformData={transformConvexBalanceData}
      />

      <Endpoint
        endpoint="liabilities"
        name="Liabilities"
        categories={liabilitiesCategories}
        schema="api.plaid.getLiabilitiesByUser"
        description="Retrieve credit card liability information including APRs and payment due dates."
        transformData={transformConvexLiabilitiesData}
      />
    </ProductTypesContainer>
  );
};

Products.displayName = "Products";

export default Products;
