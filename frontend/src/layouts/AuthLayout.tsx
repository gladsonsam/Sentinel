import Container from "@cloudscape-design/components/container";
import Box from "@cloudscape-design/components/box";
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
        <Box variant="h1" fontSize="heading-xl" fontWeight="bold" margin={{ bottom: "l" }}>
          Sentinel
        </Box>
        {children}
      </Container>
    </Box>
  );
}
