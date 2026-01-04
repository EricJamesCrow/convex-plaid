import React, { useEffect, useContext, useCallback } from "react";
import { useAction } from "convex/react";
import { api } from "./convex/_generated/api";

import Header from "./Components/Headers";
import Products from "./Components/ProductTypes/Products";
import Items from "./Components/ProductTypes/Items";
import Context from "./Context";

import styles from "./App.module.scss";

// Hardcoded for testing - in production, get from auth provider
export const TEST_USER_ID = "test-user";

const App = () => {
  const { linkSuccess, plaidItemId, dispatch } = useContext(Context);

  // Use real Convex action (not test* version)
  const createLinkToken = useAction(api.plaid.createLinkToken);

  const generateToken = useCallback(async () => {
    dispatch({ type: "SET_STATE", state: { isLoading: true } });

    try {
      const result = await createLinkToken({
        userId: TEST_USER_ID,
        products: ["transactions", "liabilities"],
      });

      if (result?.linkToken) {
        dispatch({
          type: "SET_STATE",
          state: {
            linkToken: result.linkToken,
            isLoading: false,
          }
        });
        // Save for OAuth redirect
        localStorage.setItem("link_token", result.linkToken);
      }
    } catch (error) {
      console.error("Error creating link token:", error);
      dispatch({
        type: "SET_STATE",
        state: {
          linkToken: null,
          isLoading: false,
          linkTokenError: {
            error_type: "API_ERROR",
            error_code: "LINK_TOKEN_ERROR",
            error_message: error instanceof Error ? error.message : "Failed to create link token",
          },
        },
      });
    }
  }, [createLinkToken, dispatch]);

  useEffect(() => {
    const init = async () => {
      // Handle OAuth redirect
      if (window.location.href.includes("?oauth_state_id=")) {
        dispatch({
          type: "SET_STATE",
          state: {
            linkToken: localStorage.getItem("link_token"),
          },
        });
        return;
      }

      // Generate a new link token
      generateToken();
    };

    init();
  }, [dispatch, generateToken]);

  return (
    <div className={styles.App}>
      <div className={styles.container}>
        <Header />
        {linkSuccess && (
          <>
            <Products />
            {plaidItemId && <Items />}
          </>
        )}
      </div>
    </div>
  );
};

export default App;
