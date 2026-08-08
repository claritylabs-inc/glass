export type OAuthTab = {
  navigate: (url: string) => boolean;
  close: () => void;
};

export function openOAuthTab(): OAuthTab | null {
  const popup = window.open("about:blank", "_blank");
  if (!popup) return null;

  popup.opener = null;

  return {
    navigate(url) {
      if (popup.closed) return false;
      try {
        popup.location.replace(url);
        return true;
      } catch {
        return false;
      }
    },
    close() {
      if (!popup.closed) popup.close();
    },
  };
}
