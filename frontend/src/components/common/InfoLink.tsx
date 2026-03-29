import Link from "@cloudscape-design/components/link";

interface InfoLinkProps {
  onFollow: () => void;
}

export function InfoLink({ onFollow }: InfoLinkProps) {
  return (
    <Link
      variant="info"
      href="#"
      onFollow={(event) => {
        event.preventDefault();
        onFollow();
      }}
    >
      Info
    </Link>
  );
}
