import { FormEvent, useCallback, useEffect, useState } from 'react';
import { tenantApi } from './api';
import type { AuditEntry, Message, Role, Room, Session, Site, User } from './types';

type Page = 'chat' | 'sites' | 'users' | 'audit';
const split = (value: FormDataEntryValue | null) => String(value ?? '').split(',').map(x => x.trim()).filter(Boolean);
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Unexpected error';

export function App() {
  const [session, setSession] = useState<Session>();
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<Page>('chat');
  const [notice, setNotice] = useState<string>();
  const [sites, setSites] = useState<Site[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const canManage = session?.user.role !== 'agent';

  const load = useCallback(async () => {
    const [siteData, userData, roomData] = await Promise.all([tenantApi.sites(), tenantApi.users(), tenantApi.rooms()]);
    setSites(siteData.sites); setUsers(userData.users); setRooms(roomData.rooms);
  }, []);

  useEffect(() => { tenantApi.session().then(async value => { setSession(value); await load();
    if (value.user.role !== 'agent') setAuditEntries((await tenantApi.auditLog()).entries); })
    .catch(() => {}).finally(() => setLoading(false)); }, [load]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { await tenantApi.login(String(form.get('tenant')), String(form.get('email')), String(form.get('password')));
      const next = await tenantApi.session(); setSession(next); await load();
      if (next.user.role !== 'agent') setAuditEntries((await tenantApi.auditLog()).entries);
    } catch (error) { setNotice(errorText(error)); }
  }
  async function logout() { if (!session) return; await tenantApi.logout(session.csrfToken); setSession(undefined); }
  async function run(operation: () => Promise<unknown>, success: string) {
    try { await operation(); setNotice(success); await load();
      if (canManage) setAuditEntries((await tenantApi.auditLog()).entries);
    } catch (error) { setNotice(errorText(error)); throw error; }
  }

  if (loading) return <main className="center">Loading workspace…</main>;
  if (!session) return <main className="login-shell"><form className="card login" onSubmit={login}>
    <span className="brand">Yapping Frog</span><h1>Tenant workspace</h1><p>Sign in with your tenant account.</p>
    {notice && <div className="notice">{notice}</div>}
    <label>Tenant slug<input name="tenant" required placeholder="acme-store" /></label>
    <label>Email<input name="email" type="email" required /></label>
    <label>Password<input name="password" type="password" required /></label><button>Sign in</button>
  </form></main>;

  return <div className="shell"><aside><div><span className="brand">Yapping Frog</span><h2>{session.tenant.name}</h2></div>
    <nav><button className={page === 'chat' ? 'active' : ''} onClick={() => setPage('chat')}>Chat rooms</button>
      <button className={page === 'sites' ? 'active' : ''} onClick={() => setPage('sites')}>Sites</button>
      <button className={page === 'users' ? 'active' : ''} onClick={() => setPage('users')}>Users</button>
      {canManage && <button className={page === 'audit' ? 'active' : ''} onClick={() => setPage('audit')}>Audit log</button>}</nav>
    <div className="account"><strong>{session.user.displayName}</strong><small>{session.user.role}</small><button className="muted" onClick={logout}>Sign out</button></div>
  </aside><main><header><div><h1>{page === 'chat' ? 'Chat rooms' : page === 'sites' ? 'Tenant sites' : page === 'users' ? 'Tenant users' : 'Tenant audit log'}</h1>
    <p>{session.tenant.slug}</p></div></header>{notice && <div className="notice success">{notice}</div>}
    {page === 'sites' && <Sites sites={sites} csrf={session.csrfToken} canManage={canManage} run={run} />}
    {page === 'users' && <Users users={users} csrf={session.csrfToken} canManage={canManage} run={run} />}
    {page === 'chat' && <Chat rooms={rooms} users={users} session={session} canManage={canManage} run={run} />}
    {page === 'audit' && canManage && <Audit entries={auditEntries} />}
  </main></div>;
}

function Sites({ sites, csrf, canManage, run }: { sites: Site[]; csrf: string; canManage: boolean; run: Runner }) {
  async function create(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const el=event.currentTarget; const f=new FormData(el);
    await run(() => tenantApi.createSite(csrf,String(f.get('name')),split(f.get('domains'))),'Site created.'); el.reset(); }
  return <><section className="card"><h2>Sites</h2>{canManage && <form className="form-row" onSubmit={create}>
    <label>Name<input name="name" required /></label><label>Allowed domains<input name="domains" required placeholder="example.com or *" /></label><button>Add site</button></form>}
    {sites.map(site => <form className="item-row" key={site.public_id} onSubmit={async e => { e.preventDefault(); const f=new FormData(e.currentTarget);
      await run(() => tenantApi.updateSite(csrf,{...site,name:String(f.get('name')),allowed_domains:split(f.get('domains')),status:Number(f.get('status')) as 1|2}),'Site updated.'); }}>
      <label>Name<input name="name" defaultValue={site.name} disabled={!canManage}/></label><label>Domains<input name="domains" defaultValue={site.allowed_domains.join(', ')} disabled={!canManage}/></label>
      <label>Status<select name="status" defaultValue={site.status} disabled={!canManage}><option value="1">Active</option><option value="2">Disabled</option></select></label>
      <div><small>Widget key</small><code>{site.widget_key}</code></div>{canManage && <button>Save</button>}</form>)}</section></>;
}

function Users({ users, csrf, canManage, run }: { users: User[]; csrf: string; canManage: boolean; run: Runner }) {
  const [editing,setEditing]=useState<User>();
  async function create(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const el=event.currentTarget; const f=new FormData(el);
    await run(() => tenantApi.createUser(csrf,{email:f.get('email'),displayName:f.get('name'),role:f.get('role'),password:f.get('password')}),'User created.'); el.reset(); }
  if(editing) return <UserEditor user={editing} csrf={csrf} run={run} onBack={() => setEditing(undefined)}/>;
  return <section className="card"><h2>Users</h2>{canManage && <form className="form-row user-create" onSubmit={create}>
    <label>Email<input name="email" type="email" required/></label><label>Name<input name="name" required/></label><label>Role<RoleSelect/></label>
    <label>Password<input name="password" type="password" minLength={8} required/></label><button>Add user</button></form>}
    <div className="list">{users.map(user=><div className="user-line" key={user.public_id}><div><strong>{user.display_name}</strong><small>{user.email}</small></div>
      <span>{user.role}</span><span>{user.status===1?'Active':'Disabled'}</span>{canManage&&<button onClick={()=>setEditing(user)}>Edit</button>}</div>)}</div></section>;
}
function UserEditor({user,csrf,run,onBack}:{user:User;csrf:string;run:Runner;onBack:()=>void}) {
  return <section className="card"><div className="title-row"><div><h2>Edit user</h2><p>{user.email}</p></div><button className="muted" onClick={onBack}>Back</button></div>
    <form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await run(()=>tenantApi.updateUser(csrf,{...user,email:String(f.get('email')),display_name:String(f.get('name')),role:String(f.get('role')) as Role,status:Number(f.get('status')) as 1|2,...(f.get('password')?{password:String(f.get('password'))}:{})}),'User updated.');}}>
      <div className="grid"><label>Email<input name="email" type="email" defaultValue={user.email}/></label><label>Name<input name="name" defaultValue={user.display_name}/></label>
      <label>Role<RoleSelect value={user.role}/></label><label>Status<select name="status" defaultValue={user.status}><option value="1">Active</option><option value="2">Disabled</option></select></label>
      <label>New password (optional)<input name="password" type="password" minLength={8}/></label></div><button>Save user</button></form></section>;
}
function RoleSelect({value='agent'}:{value?:Role}) { return <select name="role" defaultValue={value}><option value="owner">Owner</option><option value="administrator">Administrator</option><option value="agent">Agent</option></select>; }

function Chat({rooms,users,session,canManage,run}:{rooms:Room[];users:User[];session:Session;canManage:boolean;run:Runner}) {
  const [selected,setSelected]=useState<Room>(); const [messages,setMessages]=useState<Message[]>([]);
  const fetchMessages=useCallback(async(room:Room)=>{setMessages((await tenantApi.messages(room.public_id)).messages);},[]);
  useEffect(()=>{if(!selected)return;fetchMessages(selected);const timer=setInterval(()=>fetchMessages(selected).catch(()=>{}),3000);return()=>clearInterval(timer);},[selected,fetchMessages]);
  async function create(event:FormEvent<HTMLFormElement>){event.preventDefault();const el=event.currentTarget;const f=new FormData(el);const ids=f.getAll('members').map(String);
    await run(()=>tenantApi.createRoom(session.csrfToken,{title:f.get('title'),visibility:f.get('visibility'),pinned:f.get('pinned')==='on',memberIds:ids}),'Room created.');el.reset();}
  return <div className="chat-layout"><section className="card rooms"><h2>Rooms</h2><form onSubmit={create}><label>Title<input name="title" required maxLength={200}/></label>
    <label>Visibility<select name="visibility"><option value="tenant">Everyone in tenant</option><option value="private">Private room</option></select></label>
    <div className="members"><small>Private members</small>{users.filter(u=>u.public_id!==session.user.publicId).map(u=><label key={u.public_id}><input type="checkbox" name="members" value={u.public_id}/>{u.display_name}</label>)}</div>
    <label className="check"><input type="checkbox" name="pinned"/>Pin at top</label><button>Create room</button></form>
    <div className="room-list">{rooms.map(room=><button className={selected?.public_id===room.public_id?'selected':''} key={room.public_id} onClick={()=>setSelected(room)}>
      <span>{room.pinned?'📌 ':''}{room.title}</span><small>{room.visibility} · {room.last_message??'No messages'}</small></button>)}</div></section>
    <section className="card conversation">{!selected?<div className="empty">Select a room to start chatting.</div>:<>{canManage
      ? <form className="room-settings" key={selected.public_id} onSubmit={async event=>{event.preventDefault();const form=new FormData(event.currentTarget);
        const updated={...selected,title:String(form.get('title')),pinned:form.get('pinned')==='on'};
        await run(()=>tenantApi.updateRoom(session.csrfToken,updated),'Room updated.');setSelected(updated);}}>
        <label>Room name<input name="title" defaultValue={selected.title} required maxLength={200}/></label>
        <label className="check"><input name="pinned" type="checkbox" defaultChecked={selected.pinned}/>Pinned</label><button>Save room</button></form>
      : <div className="title-row"><div><h2>{selected.title}</h2><p>{selected.visibility} room</p></div></div>}
      <div className="messages">{messages.map(m=><div className={m.sender_public_id===session.user.publicId?'message mine':'message'} key={m.public_id}><strong>{m.sender_name}</strong><p>{m.content}</p><small>{new Date(m.created_at).toLocaleString()}</small></div>)}</div>
      <form className="composer" onSubmit={async e=>{e.preventDefault();const el=e.currentTarget;const f=new FormData(el);await tenantApi.sendMessage(session.csrfToken,selected.public_id,String(f.get('content')));el.reset();await fetchMessages(selected);}}>
        <input name="content" required maxLength={10000} placeholder="Write a message…"/><button>Send</button></form></>}</section></div>;
}
function Audit({entries}:{entries:AuditEntry[]}) { return <section className="card"><div className="title-row"><div><h2>Recent activity</h2><p>Site, user, and room management events.</p></div></div>
  <div className="audit-list">{entries.map(entry=><article key={entry.id}><div><strong>{entry.action}</strong><small>{entry.user_name??entry.user_email??'Deleted user'} · {new Date(entry.created_at).toLocaleString()}</small></div>
    <code>{entry.target_id??entry.target_type}</code><pre>{entry.metadata==null?'No metadata':JSON.stringify(entry.metadata,null,2)}</pre></article>)}
    {entries.length===0&&<p className="empty">No tenant activity recorded yet.</p>}</div></section>; }
type Runner=(operation:()=>Promise<unknown>,success:string)=>Promise<void>;
