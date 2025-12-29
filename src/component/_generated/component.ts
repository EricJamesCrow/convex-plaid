/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    actions: {
      completeReauth: FunctionReference<
        "action",
        "internal",
        { plaidItemId: string },
        { success: boolean },
        Name
      >;
      createLinkToken: FunctionReference<
        "action",
        "internal",
        {
          clientName?: string;
          countryCodes?: Array<string>;
          language?: string;
          plaidClientId: string;
          plaidEnv: string;
          plaidSecret: string;
          products?: Array<string>;
          userId: string;
          webhookUrl?: string;
        },
        { linkToken: string },
        Name
      >;
      createUpdateLinkToken: FunctionReference<
        "action",
        "internal",
        {
          encryptionKey: string;
          plaidClientId: string;
          plaidEnv: string;
          plaidItemId: string;
          plaidSecret: string;
        },
        { linkToken: string },
        Name
      >;
      enrichTransactions: FunctionReference<
        "action",
        "internal",
        {
          encryptionKey: string;
          plaidClientId: string;
          plaidEnv: string;
          plaidSecret: string;
          transactions: Array<{
            amount: number;
            description: string;
            id: string;
            iso_currency_code?: string;
            location?: {
              city?: string;
              country?: string;
              postal_code?: string;
              region?: string;
            };
            mcc?: string;
          }>;
        },
        { enriched: number; failed: number },
        Name
      >;
      exchangePublicToken: FunctionReference<
        "action",
        "internal",
        {
          encryptionKey: string;
          plaidClientId: string;
          plaidEnv: string;
          plaidSecret: string;
          products?: Array<string>;
          publicToken: string;
          userId: string;
        },
        { itemId: string; plaidItemId: string; success: boolean },
        Name
      >;
      fetchAccounts: FunctionReference<
        "action",
        "internal",
        {
          encryptionKey: string;
          plaidClientId: string;
          plaidEnv: string;
          plaidItemId: string;
          plaidSecret: string;
        },
        { accountCount: number },
        Name
      >;
      fetchLiabilities: FunctionReference<
        "action",
        "internal",
        {
          encryptionKey: string;
          plaidClientId: string;
          plaidEnv: string;
          plaidItemId: string;
          plaidSecret: string;
        },
        { creditCards: number; mortgages: number; studentLoans: number },
        Name
      >;
      fetchRecurringStreams: FunctionReference<
        "action",
        "internal",
        {
          encryptionKey: string;
          plaidClientId: string;
          plaidEnv: string;
          plaidItemId: string;
          plaidSecret: string;
        },
        { inflows: number; outflows: number },
        Name
      >;
      syncTransactions: FunctionReference<
        "action",
        "internal",
        {
          encryptionKey: string;
          maxPages?: number;
          maxTransactions?: number;
          plaidClientId: string;
          plaidEnv: string;
          plaidItemId: string;
          plaidSecret: string;
        },
        {
          added: number;
          cursor: string;
          hasMore: boolean;
          modified: number;
          pagesProcessed: number;
          removed: number;
          skipReason?: string;
          skipped?: boolean;
        },
        Name
      >;
      triggerTransactionsRefresh: FunctionReference<
        "action",
        "internal",
        {
          encryptionKey: string;
          plaidClientId: string;
          plaidEnv: string;
          plaidItemId: string;
          plaidSecret: string;
        },
        { error?: string; requestId?: string; success: boolean },
        Name
      >;
    };
    public: {
      deletePlaidItem: FunctionReference<
        "mutation",
        "internal",
        { plaidItemId: string },
        {
          deleted: {
            accounts: number;
            creditCardLiabilities: number;
            items: number;
            mortgageLiabilities: number;
            recurringStreams: number;
            studentLoanLiabilities: number;
            transactions: number;
          };
        },
        Name
      >;
      getAccountsByItem: FunctionReference<
        "query",
        "internal",
        { plaidItemId: string },
        Array<{
          _id: string;
          accountId: string;
          balances: {
            available?: number;
            current?: number;
            isoCurrencyCode: string;
            limit?: number;
          };
          createdAt: number;
          mask?: string;
          name: string;
          officialName?: string;
          plaidItemId: string;
          subtype?: string;
          type: string;
          userId: string;
        }>,
        Name
      >;
      getAccountsByUser: FunctionReference<
        "query",
        "internal",
        { userId: string },
        Array<{
          _id: string;
          accountId: string;
          balances: {
            available?: number;
            current?: number;
            isoCurrencyCode: string;
            limit?: number;
          };
          createdAt: number;
          mask?: string;
          name: string;
          officialName?: string;
          plaidItemId: string;
          subtype?: string;
          type: string;
          userId: string;
        }>,
        Name
      >;
      getActiveSubscriptions: FunctionReference<
        "query",
        "internal",
        { userId: string },
        Array<{
          _id: string;
          accountId: string;
          averageAmount: number;
          category?: string;
          createdAt: number;
          description: string;
          firstDate?: string;
          frequency: string;
          isActive: boolean;
          isoCurrencyCode: string;
          lastAmount: number;
          lastDate?: string;
          merchantName?: string;
          plaidItemId: string;
          predictedNextDate?: string;
          status: string;
          streamId: string;
          type: string;
          updatedAt: number;
          userId: string;
        }>,
        Name
      >;
      getAllInstitutions: FunctionReference<
        "query",
        "internal",
        {},
        Array<{
          _id: string;
          institutionId: string;
          lastFetched: number;
          logo?: string;
          name: string;
          primaryColor?: string;
          products?: Array<string>;
          url?: string;
        }>,
        Name
      >;
      getInstitution: FunctionReference<
        "query",
        "internal",
        { institutionId: string },
        {
          _id: string;
          institutionId: string;
          lastFetched: number;
          logo?: string;
          name: string;
          primaryColor?: string;
          products?: Array<string>;
          url?: string;
        } | null,
        Name
      >;
      getItem: FunctionReference<
        "query",
        "internal",
        { plaidItemId: string },
        {
          _id: string;
          activatedAt?: number;
          circuitState?: string;
          consecutiveFailures?: number;
          createdAt: number;
          disconnectedAt?: number;
          disconnectedReason?: string;
          errorAt?: number;
          errorCode?: string;
          errorMessage?: string;
          institutionId?: string;
          institutionName?: string;
          isActive?: boolean;
          itemId: string;
          lastFailureAt?: number;
          lastSyncedAt?: number;
          nextRetryAt?: number;
          products: Array<string>;
          reauthAt?: number;
          reauthReason?: string;
          status: string;
          syncError?: string;
          userId: string;
        } | null,
        Name
      >;
      getItemsByUser: FunctionReference<
        "query",
        "internal",
        { userId: string },
        Array<{
          _id: string;
          activatedAt?: number;
          circuitState?: string;
          consecutiveFailures?: number;
          createdAt: number;
          disconnectedAt?: number;
          disconnectedReason?: string;
          errorAt?: number;
          errorCode?: string;
          errorMessage?: string;
          institutionId?: string;
          institutionName?: string;
          isActive?: boolean;
          itemId: string;
          lastFailureAt?: number;
          lastSyncedAt?: number;
          nextRetryAt?: number;
          products: Array<string>;
          reauthAt?: number;
          reauthReason?: string;
          status: string;
          syncError?: string;
          userId: string;
        }>,
        Name
      >;
      getLiabilitiesByItem: FunctionReference<
        "query",
        "internal",
        { plaidItemId: string },
        Array<{
          _id: string;
          accountId: string;
          aprs: Array<{
            aprPercentage: number;
            aprType: string;
            balanceSubjectToApr?: number;
            interestChargeAmount?: number;
          }>;
          createdAt: number;
          isOverdue: boolean;
          lastPaymentAmount?: number;
          lastPaymentDate?: string;
          lastStatementBalance?: number;
          lastStatementIssueDate?: string;
          minimumPaymentAmount?: number;
          nextPaymentDueDate?: string;
          plaidItemId: string;
          updatedAt: number;
          userId: string;
        }>,
        Name
      >;
      getLiabilitiesByUser: FunctionReference<
        "query",
        "internal",
        { userId: string },
        Array<{
          _id: string;
          accountId: string;
          aprs: Array<{
            aprPercentage: number;
            aprType: string;
            balanceSubjectToApr?: number;
            interestChargeAmount?: number;
          }>;
          createdAt: number;
          isOverdue: boolean;
          lastPaymentAmount?: number;
          lastPaymentDate?: string;
          lastStatementBalance?: number;
          lastStatementIssueDate?: string;
          minimumPaymentAmount?: number;
          nextPaymentDueDate?: string;
          plaidItemId: string;
          updatedAt: number;
          userId: string;
        }>,
        Name
      >;
      getMerchantEnrichment: FunctionReference<
        "query",
        "internal",
        { merchantId: string },
        {
          _id: string;
          categoryDetailed?: string;
          categoryIconUrl?: string;
          categoryPrimary?: string;
          confidenceLevel: string;
          lastEnriched: number;
          logoUrl?: string;
          merchantId: string;
          merchantName: string;
          phoneNumber?: string;
          website?: string;
        } | null,
        Name
      >;
      getMortgageLiabilitiesByUser: FunctionReference<
        "query",
        "internal",
        { userId: string },
        Array<{
          _id: string;
          accountId: string;
          accountNumber?: string;
          createdAt: number;
          currentLateFee?: number;
          escrowBalance?: number;
          hasPmi?: boolean;
          hasPrepaymentPenalty?: boolean;
          interestRatePercentage: number;
          interestRateType?: string;
          lastPaymentAmount?: number;
          lastPaymentDate?: string;
          loanTerm?: string;
          loanTypeDescription?: string;
          maturityDate?: string;
          nextMonthlyPayment?: number;
          nextPaymentDueDate?: string;
          originationDate?: string;
          originationPrincipalAmount?: number;
          pastDueAmount?: number;
          plaidItemId: string;
          propertyAddress?: {
            city?: string;
            country?: string;
            postalCode?: string;
            region?: string;
            street?: string;
          };
          updatedAt: number;
          userId: string;
          ytdInterestPaid?: number;
          ytdPrincipalPaid?: number;
        }>,
        Name
      >;
      getMortgageLiabilityByAccount: FunctionReference<
        "query",
        "internal",
        { accountId: string },
        {
          _id: string;
          accountId: string;
          accountNumber?: string;
          createdAt: number;
          currentLateFee?: number;
          escrowBalance?: number;
          hasPmi?: boolean;
          hasPrepaymentPenalty?: boolean;
          interestRatePercentage: number;
          interestRateType?: string;
          lastPaymentAmount?: number;
          lastPaymentDate?: string;
          loanTerm?: string;
          loanTypeDescription?: string;
          maturityDate?: string;
          nextMonthlyPayment?: number;
          nextPaymentDueDate?: string;
          originationDate?: string;
          originationPrincipalAmount?: number;
          pastDueAmount?: number;
          plaidItemId: string;
          propertyAddress?: {
            city?: string;
            country?: string;
            postalCode?: string;
            region?: string;
            street?: string;
          };
          updatedAt: number;
          userId: string;
          ytdInterestPaid?: number;
          ytdPrincipalPaid?: number;
        } | null,
        Name
      >;
      getRecurringIncome: FunctionReference<
        "query",
        "internal",
        { userId: string },
        Array<{
          _id: string;
          accountId: string;
          averageAmount: number;
          category?: string;
          createdAt: number;
          description: string;
          firstDate?: string;
          frequency: string;
          isActive: boolean;
          isoCurrencyCode: string;
          lastAmount: number;
          lastDate?: string;
          merchantName?: string;
          plaidItemId: string;
          predictedNextDate?: string;
          status: string;
          streamId: string;
          type: string;
          updatedAt: number;
          userId: string;
        }>,
        Name
      >;
      getRecurringStreamsByItem: FunctionReference<
        "query",
        "internal",
        { plaidItemId: string },
        Array<{
          _id: string;
          accountId: string;
          averageAmount: number;
          category?: string;
          createdAt: number;
          description: string;
          firstDate?: string;
          frequency: string;
          isActive: boolean;
          isoCurrencyCode: string;
          lastAmount: number;
          lastDate?: string;
          merchantName?: string;
          plaidItemId: string;
          predictedNextDate?: string;
          status: string;
          streamId: string;
          type: string;
          updatedAt: number;
          userId: string;
        }>,
        Name
      >;
      getRecurringStreamsByUser: FunctionReference<
        "query",
        "internal",
        { userId: string },
        Array<{
          _id: string;
          accountId: string;
          averageAmount: number;
          category?: string;
          createdAt: number;
          description: string;
          firstDate?: string;
          frequency: string;
          isActive: boolean;
          isoCurrencyCode: string;
          lastAmount: number;
          lastDate?: string;
          merchantName?: string;
          plaidItemId: string;
          predictedNextDate?: string;
          status: string;
          streamId: string;
          type: string;
          updatedAt: number;
          userId: string;
        }>,
        Name
      >;
      getStudentLoanLiabilitiesByUser: FunctionReference<
        "query",
        "internal",
        { userId: string },
        Array<{
          _id: string;
          accountId: string;
          accountNumber?: string;
          createdAt: number;
          disbursementDates?: Array<string>;
          expectedPayoffDate?: string;
          guarantor?: string;
          interestRatePercentage: number;
          isOverdue?: boolean;
          lastPaymentAmount?: number;
          lastPaymentDate?: string;
          lastStatementBalance?: number;
          lastStatementIssueDate?: string;
          loanName?: string;
          loanStatus?: { endDate?: string; type?: string };
          minimumPaymentAmount?: number;
          nextPaymentDueDate?: string;
          originationDate?: string;
          originationPrincipalAmount?: number;
          outstandingInterestAmount?: number;
          paymentReferenceNumber?: string;
          plaidItemId: string;
          repaymentPlan?: { description?: string; type?: string };
          sequenceNumber?: string;
          servicerAddress?: {
            city?: string;
            country?: string;
            postalCode?: string;
            region?: string;
            street?: string;
          };
          updatedAt: number;
          userId: string;
          ytdInterestPaid?: number;
          ytdPrincipalPaid?: number;
        }>,
        Name
      >;
      getStudentLoanLiabilityByAccount: FunctionReference<
        "query",
        "internal",
        { accountId: string },
        {
          _id: string;
          accountId: string;
          accountNumber?: string;
          createdAt: number;
          disbursementDates?: Array<string>;
          expectedPayoffDate?: string;
          guarantor?: string;
          interestRatePercentage: number;
          isOverdue?: boolean;
          lastPaymentAmount?: number;
          lastPaymentDate?: string;
          lastStatementBalance?: number;
          lastStatementIssueDate?: string;
          loanName?: string;
          loanStatus?: { endDate?: string; type?: string };
          minimumPaymentAmount?: number;
          nextPaymentDueDate?: string;
          originationDate?: string;
          originationPrincipalAmount?: number;
          outstandingInterestAmount?: number;
          paymentReferenceNumber?: string;
          plaidItemId: string;
          repaymentPlan?: { description?: string; type?: string };
          sequenceNumber?: string;
          servicerAddress?: {
            city?: string;
            country?: string;
            postalCode?: string;
            region?: string;
            street?: string;
          };
          updatedAt: number;
          userId: string;
          ytdInterestPaid?: number;
          ytdPrincipalPaid?: number;
        } | null,
        Name
      >;
      getSubscriptionsSummary: FunctionReference<
        "query",
        "internal",
        { userId: string },
        {
          annualCount: number;
          biweeklyCount: number;
          count: number;
          monthlyCount: number;
          monthlyTotal: number;
          weeklyCount: number;
        },
        Name
      >;
      getSyncLogsByItem: FunctionReference<
        "query",
        "internal",
        { limit?: number; plaidItemId: string },
        Array<{
          _id: string;
          completedAt?: number;
          durationMs?: number;
          errorCode?: string;
          errorMessage?: string;
          plaidItemId: string;
          result?: {
            accountsUpdated?: number;
            creditCardsUpdated?: number;
            mortgagesUpdated?: number;
            streamsUpdated?: number;
            studentLoansUpdated?: number;
            transactionsAdded?: number;
            transactionsModified?: number;
            transactionsRemoved?: number;
          };
          retryCount?: number;
          startedAt: number;
          status: string;
          syncType: string;
          trigger: string;
          userId: string;
        }>,
        Name
      >;
      getSyncLogsByUser: FunctionReference<
        "query",
        "internal",
        { limit?: number; userId: string },
        Array<{
          _id: string;
          completedAt?: number;
          durationMs?: number;
          errorCode?: string;
          errorMessage?: string;
          plaidItemId: string;
          result?: {
            accountsUpdated?: number;
            creditCardsUpdated?: number;
            mortgagesUpdated?: number;
            streamsUpdated?: number;
            studentLoansUpdated?: number;
            transactionsAdded?: number;
            transactionsModified?: number;
            transactionsRemoved?: number;
          };
          retryCount?: number;
          startedAt: number;
          status: string;
          syncType: string;
          trigger: string;
          userId: string;
        }>,
        Name
      >;
      getSyncStats: FunctionReference<
        "query",
        "internal",
        { daysBack?: number; plaidItemId: string },
        {
          averageDurationMs?: number;
          errorCount: number;
          lastErrorAt?: number;
          lastErrorMessage?: string;
          lastSuccessAt?: number;
          lastSyncAt?: number;
          successCount: number;
          successRate: number;
          totalSyncs: number;
        },
        Name
      >;
      getTransactionsByAccount: FunctionReference<
        "query",
        "internal",
        { accountId: string; limit?: number },
        Array<{
          _id: string;
          accountId: string;
          amount: number;
          categoryDetailed?: string;
          categoryPrimary?: string;
          createdAt: number;
          date: string;
          datetime?: string;
          isoCurrencyCode: string;
          merchantName?: string;
          name: string;
          pending: boolean;
          plaidItemId: string;
          transactionId: string;
          userId: string;
        }>,
        Name
      >;
      getTransactionsByUser: FunctionReference<
        "query",
        "internal",
        {
          endDate?: string;
          limit?: number;
          startDate?: string;
          userId: string;
        },
        Array<{
          _id: string;
          accountId: string;
          amount: number;
          categoryDetailed?: string;
          categoryPrimary?: string;
          createdAt: number;
          date: string;
          datetime?: string;
          isoCurrencyCode: string;
          merchantName?: string;
          name: string;
          pending: boolean;
          plaidItemId: string;
          transactionId: string;
          userId: string;
        }>,
        Name
      >;
      setPlaidItemActive: FunctionReference<
        "mutation",
        "internal",
        { isActive: boolean; itemId: string },
        null,
        Name
      >;
      togglePlaidItemActive: FunctionReference<
        "mutation",
        "internal",
        { itemId: string },
        { isActive: boolean },
        Name
      >;
    };
  };
