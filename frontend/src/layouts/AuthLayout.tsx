import Box from "@cloudscape-design/components/box";
import { ReactNode } from "react";

interface AuthLayoutProps {
  children: ReactNode;
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <Box className="sentinel-auth-shell" textAlign="center">
      <Box className="sentinel-auth-card">
        <Box className="sentinel-auth-card-content">
          <Box className="sentinel-auth-card-brand">
            <img
              src={`${import.meta.env.BASE_URL}favicon.svg`}
              alt="Sentinel"
              className="sentinel-auth-logo"
            />
            <Box variant="h1" fontSize="heading-xl" fontWeight="bold">
              Sentinel
            </Box>
            <Box color="text-body-secondary">Sign in to continue</Box>
          </Box>

          {children}
        </Box>
      </Box>
    </Box>
  );
}
