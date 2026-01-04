import React, { useEffect, useContext, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import Button from "plaid-threads/Button";

import Context from "../../Context";
import { TEST_USER_ID } from "../../App";

const Link = () => {
  const { linkToken, dispatch } = useContext(Context);
  const [isExchanging, setIsExchanging] = useState(false);

  // Use real Convex action (not test* version)
  // Note: exchangePublicToken already calls onboardItem internally
  const exchangePublicToken = useAction(api.plaid.exchangePublicToken);

  const onSuccess = React.useCallback(
    async (publicToken: string) => {
      setIsExchanging(true);
      dispatch({ type: "SET_STATE", state: { isLoading: true } });

      try {
        // This exchanges the token AND onboards the item (syncs data)
        const result = await exchangePublicToken({
          publicToken,
          userId: TEST_USER_ID,
        });

        dispatch({
          type: "SET_STATE",
          state: {
            plaidItemId: result.plaidItemId,
            itemId: result.itemId,
            isItemAccess: true,
            linkSuccess: true,
            isLoading: false,
          },
        });
      } catch (error) {
        console.error("Error exchanging public token:", error);
        dispatch({
          type: "SET_STATE",
          state: {
            plaidItemId: null,
            itemId: null,
            isItemAccess: false,
            isError: true,
            isLoading: false,
          },
        });
      } finally {
        setIsExchanging(false);
        window.history.pushState("", "", "/");
      }
    },
    [dispatch, exchangePublicToken]
  );

  let isOauth = false;
  const config: Parameters<typeof usePlaidLink>[0] = {
    token: linkToken!,
    onSuccess,
  };

  if (window.location.href.includes("?oauth_state_id=")) {
    // @ts-ignore
    config.receivedRedirectUri = window.location.href;
    isOauth = true;
  }

  const { open, ready } = usePlaidLink(config);

  useEffect(() => {
    if (isOauth && ready) {
      open();
    }
  }, [ready, open, isOauth]);

  return (
    <Button
      type="button"
      large
      onClick={() => open()}
      disabled={!ready || isExchanging}
    >
      {isExchanging ? "Connecting..." : "Launch Link"}
    </Button>
  );
};

Link.displayName = "Link";

export default Link;
