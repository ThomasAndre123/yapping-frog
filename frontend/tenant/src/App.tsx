import { FormEvent, useCallback, useEffect, useState } from 'react';
import { tenantApi } from './api';
import { AuditPage } from './pages/AuditPage';
import { ChatRoomsPage } from './pages/ChatRoomsPage';
import { ProfilePage } from './pages/ProfilePage';
import { RoomEditorPage } from './pages/RoomEditorPage';
import { SiteEditorPage } from './pages/SiteEditorPage';
import { SitesPage } from './pages/SitesPage';
import { UserEditorPage } from './pages/UserEditorPage';
import { UsersPage } from './pages/UsersPage';
import type { AuditEntry, Room, Session, Site, User } from './types';

type Page =
    | 'chat'
    | 'room-editor'
    | 'sites'
    | 'site-editor'
    | 'users'
    | 'user-editor'
    | 'audit'
    | 'profile';

const errorText = (error: unknown) =>
    error instanceof Error ? error.message : 'Unexpected error';

export function App() {
    const [session, setSession] = useState<Session>();
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState<Page>('chat');
    const [notice, setNotice] = useState<string>();
    const [sites, setSites] = useState<Site[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [rooms, setRooms] = useState<Room[]>([]);
    const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
    const [selectedSite, setSelectedSite] = useState<Site>();
    const [selectedUser, setSelectedUser] = useState<User>();
    const [selectedRoom, setSelectedRoom] = useState<Room>();
    const [messageVersion, setMessageVersion] = useState(0);
    const canManage = session?.user.role !== 'agent';

    const loadRooms = useCallback(async () => {
        const result = await tenantApi.rooms();
        setRooms(result.rooms);
    }, []);

    const load = useCallback(async () => {
        const [siteResult, userResult, roomResult] = await Promise.all([
            tenantApi.sites(),
            tenantApi.users(),
            tenantApi.rooms(),
        ]);

        setSites(siteResult.sites);
        setUsers(userResult.users);
        setRooms(roomResult.rooms);
    }, []);

    const loadAudit = useCallback(async () => {
        const result = await tenantApi.auditLog();
        setAuditEntries(result.entries);
    }, []);

    useEffect(() => {
        tenantApi
            .session()
            .then(async (value) => {
                setSession(value);
                await load();

                if (value.user.role !== 'agent') {
                    await loadAudit();
                }
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [load, loadAudit]);

    useEffect(() => {
        if (!session) {
            return;
        }

        let socket: WebSocket | undefined;
        let reconnect: number | undefined;
        let active = true;

        const connect = () => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

            socket.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);

                    if (!String(message.type).startsWith('tenant.')) {
                        return;
                    }

                    loadRooms().catch(() => {});

                    if (message.type === 'tenant.message.created') {
                        setMessageVersion((value) => value + 1);
                    }
                } catch {}
            };

            socket.onclose = () => {
                if (active) {
                    reconnect = window.setTimeout(connect, 1500);
                }
            };
        };

        connect();

        return () => {
            active = false;

            if (reconnect) {
                window.clearTimeout(reconnect);
            }

            socket?.close();
        };
    }, [session, loadRooms]);

    async function login(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        const form = new FormData(event.currentTarget);

        try {
            await tenantApi.login(
                String(form.get('tenant')),
                String(form.get('email')),
                String(form.get('password')),
            );

            const nextSession = await tenantApi.session();

            setSession(nextSession);
            await load();

            if (nextSession.user.role !== 'agent') {
                await loadAudit();
            }
        } catch (error) {
            setNotice(errorText(error));
        }
    }

    async function logout() {
        if (!session) {
            return;
        }

        await tenantApi.logout(session.csrfToken);
        setSession(undefined);
    }

    async function run(operation: () => Promise<unknown>, success: string) {
        try {
            await operation();
            setNotice(success);
            await load();

            if (canManage) {
                await loadAudit();
            }
        } catch (error) {
            setNotice(errorText(error));
            throw error;
        }
    }

    if (loading) {
        return <main className="center">Loading workspace…</main>;
    }

    if (!session) {
        return (
            <main className="login-shell">
                <form className="card login" onSubmit={login}>
                    <span className="brand">Yapping Frog</span>
                    <h1>Tenant workspace</h1>
                    <p>Sign in with your tenant account.</p>

                    {notice && <div className="notice">{notice}</div>}

                    <label>
                        Tenant slug
                        <input name="tenant" required placeholder="acme-store" />
                    </label>

                    <label>
                        Email
                        <input name="email" type="email" required />
                    </label>

                    <label>
                        Password
                        <input name="password" type="password" required />
                    </label>

                    <button>Sign in</button>
                </form>
            </main>
        );
    }

    const unread = rooms.reduce(
        (total, room) => total + Number(room.unread_count || 0),
        0,
    );

    const go = (next: Page) => {
        setPage(next);
        setNotice(undefined);
    };

    const title =
        page.startsWith('room') || page === 'chat'
            ? 'Chat rooms'
            : page.startsWith('site')
              ? 'Tenant sites'
              : page.startsWith('user')
                ? 'Tenant users'
                : page === 'profile'
                  ? 'Your profile'
                  : 'Tenant audit log';

    return (
        <div className="shell">
            <aside>
                <div>
                    <span className="brand">Yapping Frog</span>
                    <h2>{session.tenant.name}</h2>
                </div>

                <nav>
                    <button
                        className={
                            page === 'chat' || page === 'room-editor' ? 'active' : ''
                        }
                        onClick={() => go('chat')}
                    >
                        Chat rooms
                        {unread > 0 && <b className="badge nav-badge">{unread}</b>}
                    </button>

                    <button
                        className={
                            page === 'sites' || page === 'site-editor' ? 'active' : ''
                        }
                        onClick={() => go('sites')}
                    >
                        Sites
                    </button>

                    <button
                        className={
                            page === 'users' || page === 'user-editor' ? 'active' : ''
                        }
                        onClick={() => go('users')}
                    >
                        Users
                    </button>

                    {canManage && (
                        <button
                            className={page === 'audit' ? 'active' : ''}
                            onClick={() => go('audit')}
                        >
                            Audit log
                        </button>
                    )}

                    <button
                        className={page === 'profile' ? 'active' : ''}
                        onClick={() => go('profile')}
                    >
                        Profile
                    </button>
                </nav>

                <div className="account">
                    <strong>{session.user.displayName}</strong>
                    <small>{session.user.role}</small>
                    <button className="muted" onClick={logout}>
                        Sign out
                    </button>
                </div>
            </aside>

            <main>
                <header>
                    <div>
                        <h1>{title}</h1>
                    </div>
                </header>

                {notice && <div className="notice success">{notice}</div>}

                {page === 'sites' && (
                    <SitesPage
                        sites={sites}
                        canManage={canManage}
                        onCreate={() => {
                            setSelectedSite(undefined);
                            go('site-editor');
                        }}
                        onEdit={(site) => {
                            setSelectedSite(site);
                            go('site-editor');
                        }}
                    />
                )}

                {page === 'site-editor' && canManage && (
                    <SiteEditorPage
                        site={selectedSite}
                        onBack={() => go('sites')}
                        onCreate={(name, domains) =>
                            run(
                                () =>
                                    tenantApi.createSite(
                                        session.csrfToken,
                                        name,
                                        domains,
                                    ),
                                'Site created.',
                            )
                        }
                        onUpdate={(site) =>
                            run(
                                () => tenantApi.updateSite(session.csrfToken, site),
                                'Site updated.',
                            )
                        }
                    />
                )}

                {page === 'users' && (
                    <UsersPage
                        users={users}
                        canManage={canManage}
                        onCreate={() => {
                            setSelectedUser(undefined);
                            go('user-editor');
                        }}
                        onEdit={(user) => {
                            setSelectedUser(user);
                            go('user-editor');
                        }}
                    />
                )}

                {page === 'user-editor' && canManage && (
                    <UserEditorPage
                        user={selectedUser}
                        onBack={() => go('users')}
                        onCreate={(details) =>
                            run(
                                () =>
                                    tenantApi.createUser(session.csrfToken, details),
                                'User created.',
                            )
                        }
                        onUpdate={(user) =>
                            run(
                                () => tenantApi.updateUser(session.csrfToken, user),
                                'User updated.',
                            )
                        }
                    />
                )}

                {page === 'chat' && (
                    <ChatRoomsPage
                        rooms={rooms}
                        session={session}
                        canManage={canManage}
                        messageVersion={messageVersion}
                        onCreate={() => {
                            setSelectedRoom(undefined);
                            go('room-editor');
                        }}
                        onEdit={(room) => {
                            setSelectedRoom(room);
                            go('room-editor');
                        }}
                        onRead={loadRooms}
                    />
                )}

                {page === 'room-editor' && (
                    <RoomEditorPage
                        room={selectedRoom}
                        users={users}
                        currentUserId={session.user.publicId}
                        onBack={() => go('chat')}
                        onCreate={(details) =>
                            run(
                                () =>
                                    tenantApi.createRoom(session.csrfToken, details),
                                'Room created.',
                            )
                        }
                        onUpdate={(room) =>
                            run(
                                () => tenantApi.updateRoom(session.csrfToken, room),
                                'Room updated.',
                            )
                        }
                        onDelete={(room) =>
                            run(
                                () => tenantApi.deleteRoom(session.csrfToken, room),
                                'Room deleted.',
                            )
                        }
                    />
                )}

                {page === 'audit' && canManage && (
                    <AuditPage entries={auditEntries} />
                )}

                {page === 'profile' && (
                    <ProfilePage
                        session={session}
                        onSave={async (details) => {
                            const result = await tenantApi.updateProfile(
                                session.csrfToken,
                                details,
                            );

                            setSession({
                                ...session,
                                user: result.user,
                            });
                            setNotice('Profile updated.');

                            if (canManage) {
                                await loadAudit();
                            }
                        }}
                    />
                )}
            </main>
        </div>
    );
}
