import { useCallback, useEffect, useMemo, useState } from "react";
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
import Container from "@cloudscape-design/components/container";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import Badge from "@cloudscape-design/components/badge";
import { api } from "../lib/api";
import type { DashboardRole, DashboardSessionUser, DashboardUser } from "../lib/types";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { DashboardUserAvatar } from "../components/common/DashboardUserAvatar";

const ROLE_OPTIONS: { label: string; value: DashboardRole; description: string }[] = [
  {
    label: "Viewer",
    value: "viewer",
    description: "Read agents, telemetry, activity, and audit log. Cannot use live screen, remote actions, or scripts.",
  },
  {
    label: "Operator",
    value: "operator",
    description:
      "Everything viewers can do, plus live screen, wake/clear history, software inventory refresh, agent icon, and remote scripts (when enabled on the server).",
  },
  {
    label: "Admin",
    value: "admin",
    description:
      "Full control: retention, auto-update policy, local UI passwords, users, agent groups, and alert rules.",
  },
];

const PRESET_ICONS = ["😀", "🖥️", "🔒", "🛡️", "⭐", "📊", "👤", "🚀", "💼", "🔧"];

function roleBadge(role: DashboardRole) {
  const color = role === "admin" ? "red" : role === "operator" ? "blue" : "grey";
  return <Badge color={color}>{role}</Badge>;
}

export interface UsersPageProps {
  /** Refresh parent session user (e.g. App `checkAuth`) after profile/username updates. */
  onAccountUpdated?: () => void;
}

export function UsersPage({ onAccountUpdated }: UsersPageProps) {
  const isNarrow = useMediaQuery("(max-width: 768px)");
  const [me, setMe] = useState<DashboardSessionUser | null>(null);
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

  const [selfUsername, setSelfUsername] = useState("");
  const [selfIcon, setSelfIcon] = useState("");
  const [savingSelf, setSavingSelf] = useState(false);

  const [editOther, setEditOther] = useState<null | DashboardUser>(null);
  const [editOtherUsername, setEditOtherUsername] = useState("");
  const [editOtherIcon, setEditOtherIcon] = useState("");
  const [savingOther, setSavingOther] = useState(false);

  const canManage = me?.role === "admin";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const m = await api.me();
      setMe(m);
      setSelfUsername(m.username);
      setSelfIcon(m.display_icon?.trim() ?? "");

      if (m.role === "admin") {
        const u = await api.usersList();
        setUsers(u.users);
      } else {
        setUsers(null);
      }
    } catch (e: unknown) {
      setUsers(null);
      setError(String((e as { message?: string })?.message || "Failed to load"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const items = useMemo(() => users ?? [], [users]);

  const rowActions = (): ButtonDropdownProps.ItemOrGroup[] => [
    {
      id: "edit_profile",
      text: "Username & icon",
    },
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

  const runUserAction = async (u: DashboardUser, actionId: string) => {
    if (!canManage) return;
    const { id, username } = u;

    switch (actionId) {
      case "edit_profile": {
        setEditOther(u);
        setEditOtherUsername(u.username);
        setEditOtherIcon(u.display_icon?.trim() ?? "");
        break;
      }
      case "role_viewer":
      case "role_operator":
      case "role_admin": {
        try {
          setActionError(null);
          const role = actionId.replace("role_", "") as DashboardRole;
          await api.userSetRole(id, role);
          await load();
        } catch (e: unknown) {
          setActionError(String((e as { message?: string })?.message || "Failed to update role"));
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
        } catch (e: unknown) {
          setActionError(String((e as { message?: string })?.message || "Failed to load identities"));
        }
        break;
      }
      case "delete": {
        try {
          setActionError(null);
          await api.userDelete(id);
          await load();
        } catch (e: unknown) {
          setActionError(String((e as { message?: string })?.message || "Failed to delete user"));
        }
        break;
      }
    }
  };

  const saveSelfProfile = async () => {
    if (!me) return;
    const trimmedUser = selfUsername.trim();
    if (!trimmedUser) {
      setActionError("Username is required.");
      return;
    }
    setSavingSelf(true);
    setActionError(null);
    try {
      const body: { username?: string; display_icon?: string | null } = {};
      if (trimmedUser !== me.username) body.username = trimmedUser;
      const iconTrim = selfIcon.trim();
      const prev = me.display_icon?.trim() ?? "";
      if (iconTrim !== prev) {
        body.display_icon = iconTrim.length > 0 ? iconTrim : null;
      }
      if (Object.keys(body).length === 0) {
        setSavingSelf(false);
        return;
      }
      await api.userUpdateProfile(me.id, body);
      await load();
      onAccountUpdated?.();
    } catch (e: unknown) {
      setActionError(String((e as { message?: string })?.message || "Failed to save profile"));
    } finally {
      setSavingSelf(false);
    }
  };

  const saveOtherProfile = async () => {
    if (!editOther) return;
    const trimmedUser = editOtherUsername.trim();
    if (!trimmedUser) {
      setActionError("Username is required.");
      return;
    }
    setSavingOther(true);
    setActionError(null);
    try {
      const body: { username?: string; display_icon?: string | null } = {};
      if (trimmedUser !== editOther.username) body.username = trimmedUser;
      const iconTrim = editOtherIcon.trim();
      const prev = editOther.display_icon?.trim() ?? "";
      if (iconTrim !== prev) {
        body.display_icon = iconTrim.length > 0 ? iconTrim : null;
      }
      if (Object.keys(body).length === 0) {
        setEditOther(null);
        setSavingOther(false);
        return;
      }
      await api.userUpdateProfile(editOther.id, body);
      setEditOther(null);
      await load();
      onAccountUpdated?.();
    } catch (e: unknown) {
      setActionError(String((e as { message?: string })?.message || "Failed to save user"));
    } finally {
      setSavingOther(false);
    }
  };

  const headerActions = (
    <SpaceBetween direction="horizontal" size="xs">
      <Button iconName="refresh" onClick={() => void load()} loading={loading}>
        Refresh
      </Button>
      {canManage ? (
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          Create user
        </Button>
      ) : null}
    </SpaceBetween>
  );

  const profileFields = (opts: {
    username: string;
    setUsername: (v: string) => void;
    icon: string;
    setIcon: (v: string) => void;
    idLabel: string;
  }) => (
    <SpaceBetween size="m">
      <ColumnLayout columns={isNarrow ? 1 : 2}>
        <FormField label="Sign-in username" description={opts.idLabel}>
          <Input value={opts.username} onChange={({ detail }) => opts.setUsername(detail.value)} />
        </FormField>
        <FormField
          label="Avatar icon"
          description="Optional emoji or short symbol (max 32 characters). Leave empty for initials from your username."
        >
          <Input value={opts.icon} onChange={({ detail }) => opts.setIcon(detail.value)} placeholder="e.g. 🖥️" />
        </FormField>
      </ColumnLayout>
      <div>
        <Box variant="awsui-key-label" margin={{ bottom: "xs" }}>
          Quick picks
        </Box>
        <SpaceBetween direction="horizontal" size="xs">
          {PRESET_ICONS.map((ch) => (
            <Button key={ch} variant="inline-icon" onClick={() => opts.setIcon(ch)} ariaLabel={`Use ${ch}`}>
              {ch}
            </Button>
          ))}
          <Button variant="inline-link" onClick={() => opts.setIcon("")}>
            Clear icon
          </Button>
        </SpaceBetween>
      </div>
    </SpaceBetween>
  );

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="Update your username and avatar. Admins can manage passwords, roles, and OIDC links for the whole team."
          actions={isNarrow ? undefined : headerActions}
        >
          Team &amp; profile
        </Header>
      }
    >
      <div className="sentinel-users-page">
        <SpaceBetween size="l">
          {isNarrow ? <div className="sentinel-users-toolbar-mobile">{headerActions}</div> : null}

          {error ? <Box color="text-status-error">{error}</Box> : null}
          {actionError ? (
            <Alert type="error" dismissible onDismiss={() => setActionError(null)}>
              {actionError}
            </Alert>
          ) : null}

          <ExpandableSection variant="container" headerText="What each role can do" defaultExpanded={false}>
            <SpaceBetween size="s">
              {ROLE_OPTIONS.map((r) => (
                <Box key={r.value} padding="s">
                  <Box variant="strong">{r.label}</Box>
                  <Box color="text-body-secondary">{r.description}</Box>
                </Box>
              ))}
            </SpaceBetween>
          </ExpandableSection>

          {me ? (
            <Container
              header={
                <Header variant="h2" description="Shown in the top bar and team list. Changing username affects how you sign in.">
                  Your profile
                </Header>
              }
            >
              <SpaceBetween size="l">
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <DashboardUserAvatar username={selfUsername || me.username} displayIcon={selfIcon || null} size={56} />
                  <Box color="text-body-secondary">
                    Signed in as <Box variant="strong">{me.username}</Box> ({me.role})
                  </Box>
                </div>
                {profileFields({
                  username: selfUsername,
                  setUsername: setSelfUsername,
                  icon: selfIcon,
                  setIcon: setSelfIcon,
                  idLabel: "Must be unique. Use letters, numbers, or common punctuation.",
                })}
                <Button variant="primary" onClick={() => void saveSelfProfile()} loading={savingSelf}>
                  Save your profile
                </Button>
              </SpaceBetween>
            </Container>
          ) : null}

          {canManage ? (
            <>
              <Header variant="h2" description="Create users, assign roles, reset passwords, and manage OIDC links.">
                All users
              </Header>
              {isNarrow ? (
                loading && items.length === 0 ? (
                  <Box color="text-body-secondary">Loading users…</Box>
                ) : items.length === 0 ? (
                  <Box color="text-body-secondary">No users.</Box>
                ) : (
                  <SpaceBetween size="m">
                    {items.map((u) => (
                      <Box key={u.id} variant="div" className="sentinel-users-mobile-card">
                        <SpaceBetween size="s">
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <DashboardUserAvatar username={u.username} displayIcon={u.display_icon} size={40} />
                            <div>
                              <Box variant="h3" tagOverride="div" fontSize="heading-m">
                                {u.username}
                              </Box>
                              <Box>{roleBadge(u.role)}</Box>
                            </div>
                          </div>
                          <Box color="text-body-secondary" fontSize="body-s">
                            Created {new Date(u.created_at).toLocaleString()}
                          </Box>
                          <div className="sentinel-users-manage-slot">
                            <ButtonDropdown
                              variant="primary"
                              disabled={!canManage}
                              items={rowActions()}
                              expandToViewport
                              onItemClick={({ detail }) => {
                                void runUserAction(u, detail.id);
                              }}
                            >
                              Manage
                            </ButtonDropdown>
                          </div>
                        </SpaceBetween>
                      </Box>
                    ))}
                  </SpaceBetween>
                )
              ) : (
                <Table
                  items={items}
                  loading={loading}
                  loadingText="Loading users"
                  columnDefinitions={[
                    {
                      id: "avatar",
                      header: "",
                      width: 52,
                      cell: (u) => (
                        <DashboardUserAvatar username={u.username} displayIcon={u.display_icon} size={32} />
                      ),
                    },
                    { id: "username", header: "Username", cell: (u) => u.username },
                    { id: "role", header: "Role", cell: (u) => roleBadge(u.role) },
                    {
                      id: "created",
                      header: "Created",
                      cell: (u) => new Date(u.created_at).toLocaleString(),
                    },
                    {
                      id: "actions",
                      header: "",
                      cell: (u) => (
                        <ButtonDropdown
                          variant="normal"
                          disabled={!canManage}
                          items={rowActions()}
                          expandToViewport
                          onItemClick={({ detail }) => {
                            void runUserAction(u, detail.id);
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
              )}
            </>
          ) : (
            <Alert type="info" header="Admin-only team management">
              Only administrators can view the full user list, create accounts, or change roles. You can still update your own
              username and avatar above.
            </Alert>
          )}
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
                    } catch (e: unknown) {
                      setActionError(String((e as { message?: string })?.message || "Failed to create user"));
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
            <ColumnLayout columns={isNarrow ? 1 : 2}>
              <FormField label="Username">
                <Input
                  value={create.username}
                  onChange={({ detail }) => setCreate((p) => ({ ...p, username: detail.value }))}
                />
              </FormField>
              <FormField
                label="Role"
                description={ROLE_OPTIONS.find((o) => o.value === create.role)?.description ?? ""}
              >
                <Select
                  selectedOption={{
                    label: ROLE_OPTIONS.find((o) => o.value === create.role)?.label ?? create.role,
                    value: create.role,
                  }}
                  onChange={({ detail }) => {
                    const v = detail.selectedOption.value as DashboardRole | undefined;
                    if (v) setCreate((p) => ({ ...p, role: v }));
                  }}
                  options={ROLE_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
                />
              </FormField>
            </ColumnLayout>
            <FormField
              label="Temporary password"
              description="Min 6 characters. User can change later (reset again if needed)."
            >
              <Input
                type="password"
                value={create.password}
                onChange={({ detail }) => setCreate((p) => ({ ...p, password: detail.value }))}
              />
            </FormField>
          </SpaceBetween>
        </Modal>

        <Modal
          visible={Boolean(editOther)}
          onDismiss={() => setEditOther(null)}
          header={editOther ? `Profile: ${editOther.username}` : "Edit user"}
          footer={
            <Box float="right">
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant="link" onClick={() => setEditOther(null)}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={() => void saveOtherProfile()} loading={savingOther}>
                  Save
                </Button>
              </SpaceBetween>
            </Box>
          }
        >
          {editOther ? (
            <SpaceBetween size="l">
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <DashboardUserAvatar
                  username={editOtherUsername || editOther.username}
                  displayIcon={editOtherIcon || null}
                  size={48}
                />
                {roleBadge(editOther.role)}
              </div>
              {profileFields({
                username: editOtherUsername,
                setUsername: setEditOtherUsername,
                icon: editOtherIcon,
                setIcon: setEditOtherIcon,
                idLabel: "Must be unique on this server.",
              })}
            </SpaceBetween>
          ) : null}
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
                    } catch (e: unknown) {
                      setActionError(String((e as { message?: string })?.message || "Failed to set password"));
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
                    } catch (e: unknown) {
                      setActionError(String((e as { message?: string })?.message || "Failed to link identity"));
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
            <ColumnLayout columns={isNarrow ? 1 : 2}>
              <FormField label="Issuer">
                <Input
                  value={identityLink.issuer}
                  onChange={({ detail }) => setIdentityLink((p) => ({ ...p, issuer: detail.value }))}
                />
              </FormField>
              <FormField label="Subject (sub)">
                <Input
                  value={identityLink.subject}
                  onChange={({ detail }) => setIdentityLink((p) => ({ ...p, subject: detail.value }))}
                />
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
                          } catch (e: unknown) {
                            setActionError(String((e as { message?: string })?.message || "Failed to unlink identity"));
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
      </div>
    </ContentLayout>
  );
}
