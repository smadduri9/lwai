import { useEffect } from "react";
import {
  registerWorkspaceTab,
  unregisterWorkspaceTab,
  type WorkspaceTabKey,
} from "./workspaceTabs";

/** Keep this window registered as the live tab for `key` while mounted. */
export function useWorkspaceTabRegistration(key: WorkspaceTabKey | null) {
  useEffect(() => {
    if (!key) {
      unregisterWorkspaceTab();
      return;
    }
    registerWorkspaceTab(key);
    const onHide = () => unregisterWorkspaceTab();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      unregisterWorkspaceTab();
    };
  }, [key]);
}
