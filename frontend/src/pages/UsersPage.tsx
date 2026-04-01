import { useEffect, useMemo, useState } from "react";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Table from "@cloudscape-design/components/table";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import type { ButtonDropdownProps } from "@cloudscape-design/components/button-dropdown";
import Modal from "@cloudscape-design/components/modal";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import Box from "@cloudscape-design/components/box";
import Alert from "@cloudscape-design/components/alert";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import { api } from "../lib/api";
import type { DashboardRole, DashboardUser } from "../lib/types";

const ROLE_OPTIONS: { label: string; value: DashboardRole }[] = [
  { label: "viewer", value: "viewer" },
  { label: "operator", value: "operator" },
  { label: "admin", value: "admin" },
];

export function UsersPage() {
  const [me, setMe] = useState<{ id: string; username: string; role: DashboardRole } | null>(null);
  const [users, setUsers] = useState<DashboardUser[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [create, setCreate] = useState<{ username: string; password: string; role: DashboardRole }>({
    username: "",
    password: "",
    role: "viewer",
  });

  const [pwModal, setPwModal] = useState<null | { id: string; username: string }>(null);
  const [pwValue, setPwValue] = useState("");

  const [idModal, setIdModal] = useState<null | { id: string; username: string }>(null);
  const [identities, setIdentities] = useState<any[] | null>(null);
  const [identityLink, setIdentityLink] = useState({ issuer: "", subject: "" });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, u] = await Promise.all([api.me(), api.usersList()]);
      setMe(m);
      setUsers(u.users);
    } catch (e: any) {
      setUsers(null);
      setError(String(e?.message || "Failed to load users"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const canManage = me?.role === "admin";

  const items = useMemo(() => users ?? [], [users]);

  const rowActions = (): ButtonDropdownProps.ItemOrGroup[] => [
    {
      id: "set_role",
      text: "Set role",
      items: [
        { id: "role_viewer", text: "viewer" },
        { id: "role_operator", text: "operator" },
        { id: "role_admin", text: "admin" },
      ],
    },
    { id: "reset_password", text: "Reset password" },
    { id: "linked_oidc", text: "Linked OIDC identities" },
    { id: "delete", text: "Delete" },
  ];

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="Manage local users and link/unlink OIDC identities (Authentik). Admin-only."
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button iconName="refresh" onClick={load} loading={loading}>
                Refresh
              </Button>
              <Button
                variant="primary"
                disabled={!canManage}
                onClick={() => setCreateOpen(true)}
              >
                Create user
              </Button>
            </SpaceBetween>
          }
        >
          Users
        </Header>
      }
    >
      <SpaceBetween size="l">
        {me && (
          <Box color="text-body-secondary">
            Signed in as <b>{me.username}</b> ({me.role})
          </Box>
        )}
        {error && <Box color="text-status-error">{error}</Box>}
        {actionError && (
          <Alert type="error" dismissible onDismiss={() => setActionError(null)}>
            {actionError}
          </Alert>
        )}

        <Table
          items={items}
          loading={loading}
          loadingText="Loading users"
          columnDefinitions={[
            { id: "username", header: "Username", cell: (u) => u.username },
            { id: "role", header: "Role", cell: (u) => u.role },
            { id: "created", header: "Created", cell: (u) => new Date(u.created_at).toLocaleString() },
            {
              id: "actions",
              header: "",
              cell: (u) => (
                <ButtonDropdown
                  variant="normal"
                  disabled={!canManage}
                  items={rowActions()}
                  expandToViewport
                  onItemClick={async ({ detail }) => {
                    if (!canManage) return;
                    const id = u.id;
                    const username = u.username;

                    switch (detail.id) {
                      case "role_viewer":
                      case "role_operator":
                      case "role_admin": {
                        try {
                          setActionError(null);
                          const role = detail.id.replace("role_", "") as DashboardRole;
                          await api.userSetRole(id, role);
                          await load();
                        } catch (e: any) {
                          setActionError(String(e?.message || "Failed to update role"));
                        }
                        break;
                      }
                      case "reset_password": {
                        setPwValue("");
                        setPwModal({ id, username });
                        break;
                      }
                      case "linked_oidc": {
                        setIdentities(null);
                        setIdentityLink({ issuer: "", subject: "" });
                        setIdModal({ id, username });
                        try {
                          setActionError(null);
                          const r = await api.userIdentities(id);
                          setIdentities(r.identities as any);
                        } catch (e: any) {
                          setActionError(String(e?.message || "Failed to load identities"));
                        }
                        break;
                      }
                      case "delete": {
                        try {
                          setActionError(null);
                          await api.userDelete(id);
                          await load();
                        } catch (e: any) {
                          setActionError(String(e?.message || "Failed to delete user"));
                        }
                        break;
                      }
                    }
                  }}
                >
                  Manage
                </ButtonDropdown>
              ),
            },
          ]}
          empty={<Box color="text-body-secondary">No users.</Box>}
          variant="embedded"
        />
      </SpaceBetween>

      <Modal
        visible={createOpen}
        onDismiss={() => setCreateOpen(false)}
        header="Create user"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={!create.username.trim() || create.password.length < 6}
                onClick={async () => {
                  try {
                    setActionError(null);
                    await api.userCreate({
                      username: create.username.trim(),
                      password: create.password,
                      role: create.role,
                    });
                    setCreate({ username: "", password: "", role: "viewer" });
                    setCreateOpen(false);
                    await load();
                  } catch (e: any) {
                    setActionError(String(e?.message || "Failed to create user"));
                  }
                }}
              >
                Create
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <ColumnLayout columns={2}>
            <FormField label="Username">
              <Input value={create.username} onChange={({ detail }) => setCreate((p) => ({ ...p, username: detail.value }))} />
            </FormField>
            <FormField label="Role">
              <Select
                selectedOption={{ label: create.role, value: create.role }}
                onChange={({ detail }) => {
                  const v = detail.selectedOption.value as DashboardRole | undefined;
                  if (v) setCreate((p) => ({ ...p, role: v }));
                }}
                options={ROLE_OPTIONS}
              />
            </FormField>
          </ColumnLayout>
          <FormField label="Temporary password" description="Min 6 characters. User can change later (reset again if needed).">
            <Input type="password" value={create.password} onChange={({ detail }) => setCreate((p) => ({ ...p, password: detail.value }))} />
          </FormField>
        </SpaceBetween>
      </Modal>

      <Modal
        visible={Boolean(pwModal)}
        onDismiss={() => setPwModal(null)}
        header={pwModal ? `Reset password: ${pwModal.username}` : "Reset password"}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setPwModal(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={pwValue.length < 6 || !pwModal}
                onClick={async () => {
                  if (!pwModal) return;
                  try {
                    setActionError(null);
                    await api.userSetPassword(pwModal.id, pwValue);
                    setPwModal(null);
                    setPwValue("");
                  } catch (e: any) {
                    setActionError(String(e?.message || "Failed to set password"));
                  }
                }}
              >
                Set password
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <FormField label="New password">
          <Input type="password" value={pwValue} onChange={({ detail }) => setPwValue(detail.value)} />
        </FormField>
      </Modal>

      <Modal
        visible={Boolean(idModal)}
        onDismiss={() => setIdModal(null)}
        header={idModal ? `Linked identities: ${idModal.username}` : "Linked identities"}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setIdModal(null)}>
                Close
              </Button>
              <Button
                variant="primary"
                disabled={!identityLink.issuer.trim() || !identityLink.subject.trim() || !idModal}
                onClick={async () => {
                  if (!idModal) return;
                  try {
                    setActionError(null);
                    await api.userIdentityLink(idModal.id, {
                      issuer: identityLink.issuer.trim(),
                      subject: identityLink.subject.trim(),
                    });
                    const r = await api.userIdentities(idModal.id);
                    setIdentities(r.identities as any);
                    setIdentityLink({ issuer: "", subject: "" });
                  } catch (e: any) {
                    setActionError(String(e?.message || "Failed to link identity"));
                  }
                }}
              >
                Link identity
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <ColumnLayout columns={2}>
            <FormField label="Issuer">
              <Input value={identityLink.issuer} onChange={({ detail }) => setIdentityLink((p) => ({ ...p, issuer: detail.value }))} />
            </FormField>
            <FormField label="Subject (sub)">
              <Input value={identityLink.subject} onChange={({ detail }) => setIdentityLink((p) => ({ ...p, subject: detail.value }))} />
            </FormField>
          </ColumnLayout>
          {identities && identities.length > 0 ? (
            <Table
              items={identities as any}
              wrapLines
              columnDefinitions={[
                {
                  id: "issuer",
                  header: "Issuer",
                  cell: (i: any) => <Box className="sentinel-wrap-anywhere">{i.issuer}</Box>,
                },
                {
                  id: "subject",
                  header: "Subject",
                  cell: (i: any) => <Box className="sentinel-wrap-anywhere">{i.subject}</Box>,
                },
                {
                  id: "unlink",
                  header: "",
                  cell: (i: any) => (
                    <Button
                      variant="icon"
                      iconName="close"
                      ariaLabel="Unlink identity"
                      onClick={async () => {
                        try {
                          setActionError(null);
                          await api.identityUnlink(i.id);
                          if (idModal) {
                            const r = await api.userIdentities(idModal.id);
                            setIdentities(r.identities as any);
                          }
                        } catch (e: any) {
                          setActionError(String(e?.message || "Failed to unlink identity"));
                        }
                      }}
                    />
                  ),
                },
              ]}
              variant="embedded"
            />
          ) : (
            <Box color="text-body-secondary">No linked identities.</Box>
          )}
        </SpaceBetween>
      </Modal>
    </ContentLayout>
  );
}

