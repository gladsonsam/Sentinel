import { useState, useEffect } from "react";
import { applyMode, Mode } from "@cloudscape-design/global-styles";

export type ThemeMode = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "sentinel-theme";

function getSystemTheme(): Mode {
  if (typeof window === "undefined") return Mode.Light;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? Mode.Dark
    : Mode.Light;
}

function getStoredTheme(): ThemeMode {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }
  return "system";
}

export function useTheme() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(getStoredTheme);
  const [effectiveMode, setEffectiveMode] = useState<Mode>(() => {
    const stored = getStoredTheme();
    return stored === "system" ? getSystemTheme() : stored === "dark" ? Mode.Dark : Mode.Light;
  });

  useEffect(() => {
    if (themeMode === "system") {
      const updateSystemTheme = () => {
        const systemMode = getSystemTheme();
        setEffectiveMode(systemMode);
        applyMode(systemMode);
      };

      updateSystemTheme();

      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      mediaQuery.addEventListener("change", updateSystemTheme);
      return () => mediaQuery.removeEventListener("change", updateSystemTheme);
    } else {
      const mode = themeMode === "dark" ? Mode.Dark : Mode.Light;
      setEffectiveMode(mode);
      applyMode(mode);
    }
  }, [themeMode]);

  const changeTheme = (newMode: ThemeMode) => {
    setThemeMode(newMode);
    localStorage.setItem(THEME_STORAGE_KEY, newMode);
  };

  return {
    themeMode,
    effectiveMode,
    changeTheme,
    isDark: effectiveMode === Mode.Dark,
  };
}
