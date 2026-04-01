import Container from "@cloudscape-design/components/container";
import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { ReactNode } from "react";

interface AuthLayoutProps {
  children: ReactNode;
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <Box
      padding={{ horizontal: "l" }}
      className="sentinel-auth-shell"
      textAlign="center"
    >
      <Container>
        <SpaceBetween size="l">
          <Box>
            <img
              src={`${import.meta.env.BASE_URL}favicon.svg`}
              alt="Sentinel"
              className="sentinel-auth-logo"
            />
          </Box>

          <Box>
            <Box variant="h1" fontSize="heading-xl" fontWeight="bold">
              Sentinel
            </Box>
            <Box color="text-body-secondary">Sign in to continue</Box>
          </Box>

          {children}
        </SpaceBetween>
      </Container>
    </Box>
  );
}
