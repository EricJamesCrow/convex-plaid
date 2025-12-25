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
      createLinkToken: FunctionReference<
        "action",
        "public",
        {
          clientName?: string;
          countryCodes?: string[];
          language?: string;
          plaidClientId: string;
          plaidEnv: string;
          plaidSecret: string;
          products?: string[];
          userId: string;
          webhookUrl?: string;
        },
        { linkToken: string },
        Name
      >;
      exchangePublicToken: FunctionReference<
        "action",
        "public",
        {
          encryptionKey: string;
          plaidClientId: string;
          plaidEnv: string;
          plaidSecret: string;
          publicToken: string;
          userId: string;
        },
        { itemId: string; plaidItemId: string; success: boolean },
        Name
      >;
      fetchAccounts: FunctionReference<
        "action",
        "public",
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
        "public",
        {
          encryptionKey: string;
          plaidClientId: string;
          plaidEnv: string;
          plaidItemId: string;
          plaidSecret: string;
        },
        { creditCards: number },
        Name
      >;
      syncTransactions: FunctionReference<
        "action",
        "public",
        {
          encryptionKey: string;
          plaidClientId: string;
          plaidEnv: string;
          plaidItemId: string;
          plaidSecret: string;
        },
        { added: number; cursor: string; modified: number; removed: number },
        Name
      >;
      fetchRecurringStreams: FunctionReference<
        "action",
        "public",
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
      createUpdateLinkToken: FunctionReference<
        "action",
        "public",
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
      completeReauth: FunctionReference<
        "action",
        "public",
        { plaidItemId: string },
        { success: boolean },
        Name
      >;
    };
    private: {
      getPlaidItem: FunctionReference<
        "query",
        "internal",
        { plaidItemId: string },
        {
          _id: any;
          accessToken: string;
          createdAt: number;
          cursor?: string;
          institutionId?: string;
          institutionName?: string;
          itemId: string;
          lastSyncedAt?: number;
          status: string;
          syncError?: string;
          userId: string;
        } | null,
        Name
      >;
      getPlaidItemByItemId: FunctionReference<
        "query",
        "internal",
        { itemId: string },
        any | null,
        Name
      >;
      createPlaidItem: FunctionReference<
        "mutation",
        "internal",
        {
          accessToken: string;
          institutionId?: string;
          institutionName?: string;
          itemId: string;
          status: string;
          userId: string;
        },
        string,
        Name
      >;
      updateItemStatus: FunctionReference<
        "mutation",
        "internal",
        { plaidItemId: string; status: string; syncError?: string },
        null,
        Name
      >;
      updateItemCursor: FunctionReference<
        "mutation",
        "internal",
        { cursor: string; plaidItemId: string },
        null,
        Name
      >;
      markNeedsReauth: FunctionReference<
        "mutation",
        "internal",
        { itemId: string; reason: string },
        null,
        Name
      >;
      setItemError: FunctionReference<
        "mutation",
        "internal",
        { errorCode: string; errorMessage: string; itemId: string },
        null,
        Name
      >;
      bulkUpsertAccounts: FunctionReference<
        "mutation",
        "internal",
        {
          accounts: Array<{
            accountId: string;
            balances: {
              available?: number;
              current?: number;
              isoCurrencyCode: string;
              limit?: number;
            };
            mask?: string;
            name: string;
            officialName?: string;
            subtype?: string;
            type: string;
          }>;
          plaidItemId: string;
          userId: string;
        },
        { created: number; updated: number },
        Name
      >;
      bulkUpsertTransactions: FunctionReference<
        "mutation",
        "internal",
        {
          added: Array<{
            accountId: string;
            amount: number;
            categoryDetailed?: string;
            categoryPrimary?: string;
            date: string;
            datetime?: string;
            isoCurrencyCode: string;
            merchantName?: string;
            name: string;
            paymentChannel?: string;
            pending: boolean;
            pendingTransactionId?: string;
            transactionId: string;
          }>;
          modified: Array<{
            accountId: string;
            amount: number;
            categoryDetailed?: string;
            categoryPrimary?: string;
            date: string;
            datetime?: string;
            isoCurrencyCode: string;
            merchantName?: string;
            name: string;
            paymentChannel?: string;
            pending: boolean;
            pendingTransactionId?: string;
            transactionId: string;
          }>;
          plaidItemId: string;
          removed: string[];
          userId: string;
        },
        { added: number; modified: number; removed: number },
        Name
      >;
      upsertCreditCardLiability: FunctionReference<
        "mutation",
        "internal",
        {
          accountId: string;
          aprs: Array<{
            aprPercentage: number;
            aprType: string;
            balanceSubjectToApr?: number;
            interestChargeAmount?: number;
          }>;
          isOverdue: boolean;
          lastPaymentAmount?: number;
          lastPaymentDate?: string;
          lastStatementBalance?: number;
          lastStatementIssueDate?: string;
          minimumPaymentAmount?: number;
          nextPaymentDueDate?: string;
          plaidItemId: string;
          userId: string;
        },
        string,
        Name
      >;
      scheduleSync: FunctionReference<
        "mutation",
        "internal",
        { itemId: string; syncType: string },
        null,
        Name
      >;
      deactivateItem: FunctionReference<
        "mutation",
        "internal",
        { itemId: string; reason: string },
        null,
        Name
      >;
      getAllActiveItems: FunctionReference<
        "query",
        "internal",
        Record<string, never>,
        Array<{
          _id: string;
          userId: string;
          itemId: string;
          accessToken: string;
          cursor?: string;
          lastSyncedAt?: number;
        }>,
        Name
      >;
      getItemsNeedingSync: FunctionReference<
        "query",
        "internal",
        { maxAgeHours?: number },
        Array<{
          _id: string;
          userId: string;
          itemId: string;
          accessToken: string;
          cursor?: string;
          lastSyncedAt?: number;
        }>,
        Name
      >;
      bulkUpsertRecurringStreams: FunctionReference<
        "mutation",
        "internal",
        {
          userId: string;
          plaidItemId: string;
          streams: Array<{
            streamId: string;
            accountId: string;
            description: string;
            merchantName?: string;
            averageAmount: number;
            lastAmount: number;
            isoCurrencyCode: string;
            frequency: string;
            status: "MATURE" | "EARLY_DETECTION" | "TOMBSTONED";
            isActive: boolean;
            type: "inflow" | "outflow";
            category?: string;
            firstDate?: string;
            lastDate?: string;
            predictedNextDate?: string;
          }>;
        },
        { created: number; updated: number },
        Name
      >;
      tombstoneStreams: FunctionReference<
        "mutation",
        "internal",
        { plaidItemId: string; streamIds: string[] },
        { tombstoned: number },
        Name
      >;
    };
    public: {
      getItemsByUser: FunctionReference<
        "query",
        "public",
        { userId: string },
        Array<{
          _id: string;
          createdAt: number;
          institutionId?: string;
          institutionName?: string;
          itemId: string;
          lastSyncedAt?: number;
          status: string;
          syncError?: string;
          userId: string;
        }>,
        Name
      >;
      getItem: FunctionReference<
        "query",
        "public",
        { plaidItemId: string },
        {
          _id: string;
          createdAt: number;
          institutionId?: string;
          institutionName?: string;
          itemId: string;
          lastSyncedAt?: number;
          status: string;
          syncError?: string;
          userId: string;
        } | null,
        Name
      >;
      getAccountsByUser: FunctionReference<
        "query",
        "public",
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
      getAccountsByItem: FunctionReference<
        "query",
        "public",
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
      getTransactionsByAccount: FunctionReference<
        "query",
        "public",
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
        "public",
        { endDate?: string; limit?: number; startDate?: string; userId: string },
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
      getLiabilitiesByItem: FunctionReference<
        "query",
        "public",
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
        "public",
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
      deletePlaidItem: FunctionReference<
        "mutation",
        "public",
        { plaidItemId: string },
        {
          deleted: {
            accounts: number;
            items: number;
            liabilities: number;
            transactions: number;
            recurringStreams: number;
          };
        },
        Name
      >;
      getRecurringStreamsByUser: FunctionReference<
        "query",
        "public",
        { userId: string },
        Array<{
          _id: string;
          userId: string;
          plaidItemId: string;
          streamId: string;
          accountId: string;
          description: string;
          merchantName?: string;
          averageAmount: number;
          lastAmount: number;
          isoCurrencyCode: string;
          frequency: string;
          status: string;
          isActive: boolean;
          type: string;
          category?: string;
          firstDate?: string;
          lastDate?: string;
          predictedNextDate?: string;
          createdAt: number;
          updatedAt: number;
        }>,
        Name
      >;
      getRecurringStreamsByItem: FunctionReference<
        "query",
        "public",
        { plaidItemId: string },
        Array<{
          _id: string;
          userId: string;
          plaidItemId: string;
          streamId: string;
          accountId: string;
          description: string;
          merchantName?: string;
          averageAmount: number;
          lastAmount: number;
          isoCurrencyCode: string;
          frequency: string;
          status: string;
          isActive: boolean;
          type: string;
          category?: string;
          firstDate?: string;
          lastDate?: string;
          predictedNextDate?: string;
          createdAt: number;
          updatedAt: number;
        }>,
        Name
      >;
      getActiveSubscriptions: FunctionReference<
        "query",
        "public",
        { userId: string },
        Array<{
          _id: string;
          userId: string;
          plaidItemId: string;
          streamId: string;
          accountId: string;
          description: string;
          merchantName?: string;
          averageAmount: number;
          lastAmount: number;
          isoCurrencyCode: string;
          frequency: string;
          status: string;
          isActive: boolean;
          type: string;
          category?: string;
          firstDate?: string;
          lastDate?: string;
          predictedNextDate?: string;
          createdAt: number;
          updatedAt: number;
        }>,
        Name
      >;
      getRecurringIncome: FunctionReference<
        "query",
        "public",
        { userId: string },
        Array<{
          _id: string;
          userId: string;
          plaidItemId: string;
          streamId: string;
          accountId: string;
          description: string;
          merchantName?: string;
          averageAmount: number;
          lastAmount: number;
          isoCurrencyCode: string;
          frequency: string;
          status: string;
          isActive: boolean;
          type: string;
          category?: string;
          firstDate?: string;
          lastDate?: string;
          predictedNextDate?: string;
          createdAt: number;
          updatedAt: number;
        }>,
        Name
      >;
      getSubscriptionsSummary: FunctionReference<
        "query",
        "public",
        { userId: string },
        {
          count: number;
          monthlyTotal: number;
          weeklyCount: number;
          biweeklyCount: number;
          monthlyCount: number;
          annualCount: number;
        },
        Name
      >;
    };
  };
