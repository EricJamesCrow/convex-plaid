import React, { useState } from "react";
import { useQuery } from "convex/react";
import Button from "plaid-threads/Button";
import Note from "plaid-threads/Note";
import { api } from "../../convex/_generated/api";

import Table from "../Table";
import ErrorDisplay from "../Error";
import { DataItem, Categories, ErrorDataItem, Data } from "../../dataUtilities";
import { TEST_USER_ID } from "../../App";

import styles from "./index.module.scss";

// Map endpoint names to Convex queries
type ConvexQueryType = "transactions" | "balance" | "liabilities" | "items";

interface Props {
  endpoint: ConvexQueryType;
  name?: string;
  categories: Array<Categories>;
  schema: string;
  description: string;
  transformData: (arg: any) => Array<DataItem>;
}

const Endpoint = (props: Props) => {
  const [showTable, setShowTable] = useState(false);
  const [transformedData, setTransformedData] = useState<Data>([]);
  const [error, setError] = useState<ErrorDataItem | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Use real Convex queries (not test* versions) with userId
  const transactions = useQuery(
    api.plaid.getTransactionsByUser,
    props.endpoint === "transactions" ? { userId: TEST_USER_ID } : "skip"
  );
  const accounts = useQuery(
    api.plaid.getAccountsByUser,
    props.endpoint === "balance" ? { userId: TEST_USER_ID } : "skip"
  );
  const liabilities = useQuery(
    api.plaid.getLiabilitiesByUser,
    props.endpoint === "liabilities" ? { userId: TEST_USER_ID } : "skip"
  );
  const items = useQuery(
    api.plaid.getItemsByUser,
    props.endpoint === "items" ? { userId: TEST_USER_ID } : "skip"
  );

  const getData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      let data: any;

      switch (props.endpoint) {
        case "transactions":
          data = transactions;
          break;
        case "balance":
          data = accounts;
          break;
        case "liabilities":
          data = liabilities;
          break;
        case "items":
          data = items;
          break;
        default:
          throw new Error(`Unknown endpoint: ${props.endpoint}`);
      }

      if (data === undefined) {
        // Still loading
        setIsLoading(false);
        return;
      }

      if (data === null || (Array.isArray(data) && data.length === 0)) {
        setError({
          error_type: "NO_DATA",
          error_code: "EMPTY_RESPONSE",
          error_message: "No data available. Make sure you've connected a bank account.",
          display_message: null,
          status_code: null,
        });
        setIsLoading(false);
        return;
      }

      // Transform data for display
      setTransformedData(props.transformData(data));
      setShowTable(true);
    } catch (err: unknown) {
      console.error("Error fetching data:", err);
      setError({
        error_type: "API_ERROR",
        error_code: "FETCH_ERROR",
        error_message: err instanceof Error ? err.message : "Failed to fetch data",
        display_message: null,
        status_code: null,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <div className={styles.endpointContainer}>
        <Note info className={styles.post}>
          QUERY
        </Note>
        <div className={styles.endpointContents}>
          <div className={styles.endpointHeader}>
            {props.name != null && (
              <span className={styles.endpointName}>{props.name}</span>
            )}
            <span className={styles.schema}>{props.schema}</span>
          </div>
          <div className={styles.endpointDescription}>{props.description}</div>
        </div>
        <div className={styles.buttonsContainer}>
          <Button
            small
            centered
            wide
            secondary
            className={styles.sendRequest}
            onClick={getData}
          >
            {isLoading ? "Loading..." : `Fetch data`}
          </Button>
        </div>
      </div>
      {showTable && (
        <Table
          categories={props.categories}
          data={transformedData}
          isIdentity={false}
        />
      )}
      {error != null && <ErrorDisplay error={error} />}
    </>
  );
};

Endpoint.displayName = "Endpoint";

export default Endpoint;
