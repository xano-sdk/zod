/**
 * The workspace the emitted-file suites render a real `routes.gen.ts` from.
 *
 * The SDK's own route-input parity defs (every input type the SDK authors, as a
 * scalar and as a list, and each flag that changes the rendered key), authored
 * against the installed `@xano/sdk`, plus `validated`: the methods this module
 * maps to zod checks and the ones it deliberately skips.
 */
import { apiGroup, f, input, query, realtimeChannel, realtimeMessage, realtimeServer, table, workspace } from "@xano/sdk";

const api = apiGroup({ name: "api", canonical: "api1" });
const v1 = apiGroup({ name: "v1", canonical: "v1c" });
const v2 = apiGroup({ name: "v2", canonical: "v2c" });

export const users = table({
  name: "users",
  schema: {
    name: f.text({ required: true }),
    secret: f.text(),
    age: f.int(),
    bio: f.text({ nullable: true }),
    avatar: f.image(),
    prefs: f.object({ theme: f.enum(["light", "dark"]), beta: f.bool({ required: true }) }),
  },
});

export const docs = table({ name: "docs", idType: "uuid", schema: { title: f.text() } });

/** Every scalar type, one input each, with the flags that change the key. */
export const scalars = query({
  name: "scalars",
  verb: "POST",
  apiGroup: api,
  input: {
    text: input.text({ required: true }),
    text_default: input.text({ required: true, default: "hi" }),
    url: input.url(),
    int: input.int(),
    decimal: input.decimal({ nullable: true }),
    bool: input.bool({ required: true, nullable: true }),
    email: input.email(),
    password: input.password(),
    uuid: input.uuid(),
    uuid_strict: input.uuid({ nullable: false }),
    date: input.date(),
    timestamp: input.timestamp({ required: true, nullable: false }),
    json: input.json(),
    json_strict: input.json({ nullable: false }),
    file: input.file(),
    attachment: input.attachment(),
    image: input.image({ required: true }),
    video: input.video(),
    audio: input.audio(),
    point: input.geo.point(),
    multipoint: input.geo.multipoint(),
    linestring: input.geo.linestring(),
    multilinestring: input.geo.multilinestring(),
    polygon: input.geo.polygon(),
    multipolygon: input.geo.multipolygon({ nullable: false }),
    status: input.enum(["draft", "live"], { required: true }),
    level: input.enum([1, 2, 3]),
    nothing: input.enum([]),
    embedding: input.vector(3),
    owner: input.tableRef(users),
    doc: input.tableRef(docs, { required: true }),
    address: input.object(
      {
        street: f.text({ required: true }),
        unit: f.text({ nullable: true }),
        when: f.date(),
        geo: f.object({ lat: f.decimal({ required: true }), lng: f.decimal() }),
        tags: f.text({ array: true }),
      },
      { required: true },
    ),
    // Optional keys named after Object.prototype members widen; a required one does not.
    constructor: input.int(),
    toString: input.text(),
    valueOf: input.text({ required: true }),
  },
  stack: [],
  response: {},
});

/** Every type again, as a list. */
export const lists = query({
  name: "lists",
  verb: "POST",
  apiGroup: api,
  input: {
    text: input.list(input.text(), { required: true }),
    int: input.list(input.int(), { nullable: true }),
    decimal: input.list(input.decimal()),
    bool: input.list(input.bool()),
    email: input.list(input.email()),
    uuid: input.list(input.uuid()),
    date: input.list(input.date()),
    timestamp: input.list(input.timestamp()),
    json: input.list(input.json()),
    file: input.list(input.file()),
    image: input.list(input.image(), { nullable: false }),
    point: input.list(input.geo.point()),
    polygon: input.list(input.geo.polygon()),
    status: input.list(input.enum(["a", "b"])),
    embedding: input.list(input.vector(2)),
    owners: input.list(input.tableRef(users)),
    docs: input.list(input.tableRef(docs)),
    rows: input.list(input.object({ id: f.int({ required: true }), note: f.text() })),
  },
  stack: [],
  response: {},
});

/**
 * A dbLink beside a plain input. The deliberate divergence: the type is the
 * linked table's expanded columns, not `InferInput`'s opaque marker.
 */
export const signup = query({
  name: "signup",
  verb: "POST",
  apiGroup: api,
  input: {
    user__: input.dbLink(users, {
      hidden: ["secret"],
      customize: { age: { required: true }, bio: { hidden: true } },
    }),
    plan: input.enum(["free", "pro"], { required: true }),
  },
  stack: [],
  response: {},
});

/** Methods: the validating ones become zod checks, the transforming ones do not. */
export const validated = query({
  name: "validated",
  verb: "POST",
  apiGroup: api,
  input: {
    handle: input.text({ required: true, methods: ["min:3", "max:8", "startsWith:@"] }),
    slug: input.text({ methods: ["pattern:^[a-z0-9-]+$"] }),
    code: input.text({ methods: ["trim", "upper", "max:4", "pattern:/^[A-Z]+$/"] }),
    pin: input.text({ methods: ["digitOk"] }),
    secret: input.password({ required: true, methods: ["min:8", "minDigit:1", "minUpperAlpha:1", "salt:abc"] }),
    shout: input.text({ methods: ["lower", "upper", "trim"] }),
    qty: input.int({ required: true, default: 1, methods: ["min:1", "max:10"] }),
    ratio: input.decimal({ methods: ["min:0", "max:1"] }),
    tags: input.list(input.text({ methods: ["max:5"] }), { list: { min: 1, max: 3 } }),
  },
  stack: [],
  response: {},
});

export const nothing = query({ name: "nothing", verb: "GET", apiGroup: api, stack: [], response: {} });

/** `GET vehicles` in two api groups: keyed `v1:GET vehicles` / `v2:GET vehicles`. */
export const vehiclesV1 = query({
  name: "vehicles",
  verb: "GET",
  apiGroup: v1,
  input: { page: input.int() },
  stack: [],
  response: {},
});
export const vehiclesV2 = query({
  name: "vehicles",
  verb: "GET",
  apiGroup: v2,
  input: { cursor: input.text({ required: true }) },
  stack: [],
  response: {},
});

const chat = realtimeServer({ name: "chat", canonical: "chat-abc", enabled: true });
export const rooms = realtimeChannel({ name: "rooms/{room_id}", server: chat, input: { room_id: input.int({ required: true }) } });
export const lobby = realtimeChannel({ name: "lobby", server: chat });
export const send = realtimeMessage({
  name: "send",
  channel: rooms,
  input: { body: input.text({ required: true }), attachments: input.list(input.image()) },
});
export const ping = realtimeMessage({ name: "ping", channel: lobby });

export function routeInputWorkspace() {
  return workspace("ws")
    .registerTables([users, docs])
    .registerApiGroups([api, v1, v2])
    .registerQueries([scalars, lists, signup, validated, nothing, vehiclesV1, vehiclesV2])
    .registerRealtimeServers([chat])
    .registerRealtimeChannels([rooms, lobby])
    .registerRealtimeMessages([send, ping]);
}

/** A realtime-only workspace: an empty `RouteInputs`, the realtime maps filled. */
export function realtimeOnlyWorkspace() {
  return workspace("rt")
    .registerRealtimeServers([chat])
    .registerRealtimeChannels([rooms, lobby])
    .registerRealtimeMessages([send, ping]);
}
