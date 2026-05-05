export const printZReport = async (content: string): Promise<void> => {
  if (!content) {
    return;
  }

  console.warn('POS printer integration not configured. Z-report payload:', content);
};

export const openCashDrawer = async (): Promise<void> => {
  console.warn('POS cash drawer integration not configured.');
};
