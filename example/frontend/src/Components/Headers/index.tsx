import React, { useContext } from "react";
import Callout from "plaid-threads/Callout";
import Button from "plaid-threads/Button";
import InlineLink from "plaid-threads/InlineLink";

import Link from "../Link";
import Context from "../../Context";

import styles from "./index.module.scss";

const Header = () => {
  const {
    plaidItemId,
    itemId,
    linkToken,
    linkSuccess,
    isItemAccess,
    isLoading,
    linkTokenError,
  } = useContext(Context);

  return (
    <div className={styles.grid}>
      <h3 className={styles.title}>Convex Plaid Component Test</h3>

      {!linkSuccess ? (
        <>
          <h4 className={styles.subtitle}>
            Testing @crowdevelopment/convex-plaid integration
          </h4>
          <p className={styles.introPar}>
            This app tests the Convex Plaid component with sandbox credentials.
            Click the button below to launch Plaid Link and connect a test bank account.
            Use sandbox credentials: <strong>user_good</strong> / <strong>pass_good</strong>
          </p>
          {/* Error message if link token creation failed */}
          {linkToken === null && linkTokenError.error_message ? (
            <Callout warning>
              <div>
                Unable to create link token. Make sure the Convex backend is running
                and environment variables are configured correctly.
              </div>
              <div>
                Error Code: <code>{linkTokenError.error_code}</code>
              </div>
              <div>
                Error Type: <code>{linkTokenError.error_type}</code>
              </div>
              <div>Error Message: {linkTokenError.error_message}</div>
            </Callout>
          ) : linkToken === "" || isLoading ? (
            <div className={styles.linkButton}>
              <Button large disabled>
                Loading...
              </Button>
            </div>
          ) : (
            <div className={styles.linkButton}>
              <Link />
            </div>
          )}
        </>
      ) : (
        <>
          {isItemAccess ? (
            <h4 className={styles.subtitle}>
              Congrats! You've successfully connected a bank account using{" "}
              <InlineLink
                href="https://github.com/EricJamesCrow/convex-plaid"
                target="_blank"
              >
                @crowdevelopment/convex-plaid
              </InlineLink>
            </h4>
          ) : (
            <h4 className={styles.subtitle}>
              <Callout warning>
                Unable to create an item. Check the console for errors.
              </Callout>
            </h4>
          )}
          <div className={styles.itemAccessContainer}>
            {itemId && (
              <p className={styles.itemAccessRow}>
                <span className={styles.idName}>item_id</span>
                <span className={styles.tokenText}>{itemId}</span>
              </p>
            )}

            {plaidItemId && (
              <p className={styles.itemAccessRow}>
                <span className={styles.idName}>plaidItemId</span>
                <span className={styles.tokenText}>{plaidItemId}</span>
              </p>
            )}

            <p className={styles.itemAccessRow}>
              <span className={styles.idName}>access_token</span>
              <span className={styles.tokenText}>
                <em>(encrypted in Convex database)</em>
              </span>
            </p>
          </div>
          {isItemAccess && (
            <p className={styles.requests}>
              The item has been onboarded! Use the buttons below to fetch data
              from Convex:
            </p>
          )}
        </>
      )}
    </div>
  );
};

Header.displayName = "Header";

export default Header;
