import React from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import ProductTypesContainer from "./ProductTypesContainer";
import { TEST_USER_ID } from "../../App";

import styles from "./Items.module.scss";

const Items = () => {
  // Use real query with userId
  const items = useQuery(api.plaid.getItemsByUser, { userId: TEST_USER_ID }) || [];

  return (
    <ProductTypesContainer productType="Linked Items">
      <div className={styles.itemsContainer}>
        {items.length === 0 ? (
          <p>No linked items found.</p>
        ) : (
          <div className={styles.itemsList}>
            {items.map((item: any) => (
              <div key={item._id} className={styles.itemCard}>
                <div className={styles.itemHeader}>
                  <strong>{item.institutionName || "Unknown Institution"}</strong>
                  <span className={styles.status} data-status={item.status}>
                    {item.status}
                  </span>
                </div>
                <div className={styles.itemDetails}>
                  <p><strong>Item ID:</strong> {item.itemId}</p>
                  <p><strong>Created:</strong> {new Date(item.createdAt).toLocaleDateString()}</p>
                  {item.lastSyncedAt && (
                    <p><strong>Last Synced:</strong> {new Date(item.lastSyncedAt).toLocaleDateString()}</p>
                  )}
                  {item.syncError && (
                    <p className={styles.error}><strong>Error:</strong> {item.syncError}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </ProductTypesContainer>
  );
};

Items.displayName = "Items";

export default Items;
