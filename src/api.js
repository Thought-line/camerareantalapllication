// REST API for LensLease. Pure functions over the JSON store; server.js does the plumbing.
import {
  load,
  persist,
  resetDb,
  id,
  today,
  isValidDate,
  rentalDays,
  availability,
  quote,
  refreshOverdue,
  RATES,
  ACTIVE_STATUSES,
} from './store.js';

// ------------------------------------------------------------ demo sessions
// In-memory only: restarting the server signs everyone out. Fine for a demo.
const sessions = new Map();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (msg) => new HttpError(400, msg);

function requireUser(ctx) {
  if (!ctx.user) throw new HttpError(401, 'Sign in to continue.');
  return ctx.user;
}
function requireAdmin(ctx) {
  const u = requireUser(ctx);
  if (u.role !== 'admin') throw new HttpError(403, 'Admin access required.');
  return u;
}

export function userForToken(token) {
  if (!token) return null;
  const userId = sessions.get(token);
  if (!userId) return null;
  return load().users.find((u) => u.id === userId) ?? null;
}

// ------------------------------------------------------------ helpers

function dateWindow(q) {
  const from = isValidDate(q.from) ? q.from : today();
  const to = isValidDate(q.to) && q.to >= from ? q.to : from;
  return { from, to };
}

function decorate(cam, from, to) {
  const av = availability(cam.id, from, to);
  return { ...cam, availability: av, window: { from, to } };
}

function validateRange(startDate, endDate) {
  if (!isValidDate(startDate) || !isValidDate(endDate)) throw bad('Pick a valid start and end date.');
  if (endDate < startDate) throw bad('The return date must be on or after the pickup date.');
  if (startDate < today()) throw bad('Rentals cannot start in the past.');
  const days = rentalDays(startDate, endDate);
  if (days > 60) throw bad('Rentals are capped at 60 days. Contact us for long-term hire.');
  return days;
}

function normaliseItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw bad('Your cart is empty.');
  const { cameras } = load();
  const merged = new Map();
  for (const raw of rawItems) {
    const cam = cameras.find((c) => c.id === raw.cameraId);
    if (!cam) throw bad(`Unknown item: ${raw.cameraId}`);
    const qty = Math.max(1, Math.min(10, Number(raw.qty) || 1));
    const prev = merged.get(cam.id);
    merged.set(cam.id, {
      cameraId: cam.id,
      name: cam.name,
      dailyRate: cam.dailyRate,
      qty: Math.min(10, (prev?.qty ?? 0) + qty),
    });
  }
  return [...merged.values()];
}

const bookingView = (b) => ({ ...b, pricing: quote(b.items, b.startDate, b.endDate, b.insurance) });

// ------------------------------------------------------------ routes

export const routes = [
  // ---- auth
  {
    method: 'POST',
    path: '/api/auth/login',
    handler: ({ body }) => {
      const email = String(body.email ?? '').trim().toLowerCase();
      const user = load().users.find((u) => u.email.toLowerCase() === email);
      if (!user) throw new HttpError(401, 'No demo account with that email. Try alex@demo.io.');
      const token = id('tok');
      sessions.set(token, user.id);
      return { token, user };
    },
  },
  {
    method: 'POST',
    path: '/api/auth/logout',
    handler: ({ token }) => {
      sessions.delete(token);
      return { ok: true };
    },
  },
  {
    method: 'GET',
    path: '/api/auth/me',
    handler: ({ user }) => ({ user: user ?? null, demoAccounts: load().users }),
  },

  // ---- catalogue
  {
    method: 'GET',
    path: '/api/catalog',
    handler: ({ query }) => {
      refreshOverdue();
      const { from, to } = dateWindow(query);
      const { cameras } = load();
      const search = String(query.search ?? '').trim().toLowerCase();

      let list = cameras.map((c) => decorate(c, from, to));
      if (query.category && query.category !== 'all') {
        list = list.filter((c) => c.category === query.category);
      }
      if (query.brand && query.brand !== 'all') {
        list = list.filter((c) => c.brand === query.brand);
      }
      if (search) {
        list = list.filter((c) =>
          [c.name, c.brand, c.category, c.tagline, ...(c.specs ?? [])]
            .join(' ')
            .toLowerCase()
            .includes(search),
        );
      }
      if (query.availableOnly === 'true') list = list.filter((c) => c.availability.available > 0);

      const sorters = {
        'price-asc': (a, b) => a.dailyRate - b.dailyRate,
        'price-desc': (a, b) => b.dailyRate - a.dailyRate,
        rating: (a, b) => b.rating - a.rating,
        name: (a, b) => a.name.localeCompare(b.name),
      };
      list.sort(sorters[query.sort] ?? sorters.rating);

      return {
        window: { from, to, days: rentalDays(from, to) },
        categories: [...new Set(cameras.map((c) => c.category))].sort(),
        brands: [...new Set(cameras.map((c) => c.brand))].sort(),
        count: list.length,
        cameras: list,
      };
    },
  },
  {
    method: 'GET',
    path: '/api/cameras/:id',
    handler: ({ params, query }) => {
      const { from, to } = dateWindow(query);
      const cam = load().cameras.find((c) => c.id === params.id);
      if (!cam) throw new HttpError(404, 'Camera not found.');
      const related = load()
        .cameras.filter((c) => c.id !== cam.id && (c.category === cam.category || c.brand === cam.brand))
        .slice(0, 3)
        .map((c) => decorate(c, from, to));
      return { camera: decorate(cam, from, to), related };
    },
  },
  {
    method: 'POST',
    path: '/api/cameras',
    handler: ({ body, ...ctx }) => {
      requireAdmin(ctx);
      const required = ['name', 'brand', 'category', 'dailyRate'];
      for (const f of required) if (!body[f]) throw bad(`Missing field: ${f}`);
      const cam = {
        id: id('cam'),
        name: String(body.name).slice(0, 80),
        brand: String(body.brand).slice(0, 40),
        category: String(body.category).slice(0, 40),
        tagline: String(body.tagline ?? '').slice(0, 120),
        description: String(body.description ?? '').slice(0, 1000),
        specs: Array.isArray(body.specs) ? body.specs.slice(0, 8).map(String) : [],
        dailyRate: Math.max(1, Number(body.dailyRate) || 1),
        deposit: Math.max(0, Number(body.deposit) || 0),
        stock: Math.max(0, Math.min(99, Number(body.stock) || 1)),
        accent: /^#[0-9a-f]{6}$/i.test(body.accent ?? '') ? body.accent : '#4f46e5',
        icon: body.icon ?? 'camera',
        rating: 5,
      };
      load().cameras.push(cam);
      persist();
      return { camera: cam };
    },
  },
  {
    method: 'PATCH',
    path: '/api/cameras/:id',
    handler: ({ params, body, ...ctx }) => {
      requireAdmin(ctx);
      const cam = load().cameras.find((c) => c.id === params.id);
      if (!cam) throw new HttpError(404, 'Camera not found.');
      for (const key of ['name', 'brand', 'category', 'tagline', 'description', 'accent']) {
        if (body[key] != null) cam[key] = String(body[key]);
      }
      if (body.dailyRate != null) cam.dailyRate = Math.max(1, Number(body.dailyRate));
      if (body.deposit != null) cam.deposit = Math.max(0, Number(body.deposit));
      if (body.stock != null) cam.stock = Math.max(0, Math.min(99, Number(body.stock)));
      persist();
      return { camera: cam };
    },
  },
  {
    method: 'DELETE',
    path: '/api/cameras/:id',
    handler: ({ params, ...ctx }) => {
      requireAdmin(ctx);
      const db = load();
      const held = db.bookings.some(
        (b) => ACTIVE_STATUSES.includes(b.status) && b.items.some((i) => i.cameraId === params.id),
      );
      if (held) throw bad('That item is on an active booking and cannot be removed.');
      const before = db.cameras.length;
      db.cameras = db.cameras.filter((c) => c.id !== params.id);
      if (db.cameras.length === before) throw new HttpError(404, 'Camera not found.');
      persist();
      return { ok: true };
    },
  },

  // ---- quoting
  {
    method: 'POST',
    path: '/api/quote',
    handler: ({ body }) => {
      const items = normaliseItems(body.items);
      validateRange(body.startDate, body.endDate);
      const unavailable = items
        .map((it) => ({ it, av: availability(it.cameraId, body.startDate, body.endDate) }))
        .filter(({ it, av }) => av.available < it.qty)
        .map(({ it, av }) => ({ cameraId: it.cameraId, name: it.name, wanted: it.qty, available: av.available }));
      return {
        pricing: quote(items, body.startDate, body.endDate, Boolean(body.insurance)),
        items,
        unavailable,
        rates: RATES,
      };
    },
  },

  // ---- bookings
  {
    method: 'GET',
    path: '/api/bookings',
    handler: (ctx) => {
      const user = requireUser(ctx);
      refreshOverdue();
      const all = load().bookings;
      const mine = user.role === 'admin' ? all : all.filter((b) => b.userId === user.id);
      const sorted = [...mine].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { bookings: sorted.map(bookingView), scope: user.role === 'admin' ? 'all' : 'mine' };
    },
  },
  {
    method: 'POST',
    path: '/api/bookings',
    handler: ({ body, ...ctx }) => {
      const user = requireUser(ctx);
      const items = normaliseItems(body.items);
      validateRange(body.startDate, body.endDate);

      const shortfall = items
        .map((it) => ({ it, av: availability(it.cameraId, body.startDate, body.endDate) }))
        .filter(({ it, av }) => av.available < it.qty);
      if (shortfall.length) {
        const names = shortfall.map(({ it, av }) => `${it.name} (${av.available} left)`).join(', ');
        throw new HttpError(409, `Not enough stock for those dates: ${names}`);
      }

      const db = load();
      const booking = {
        id: id('bk'),
        code: `LL-${Math.floor(1000 + Math.random() * 8999)}`,
        userId: user.id,
        customerName: user.name,
        customerEmail: user.email,
        items,
        startDate: body.startDate,
        endDate: body.endDate,
        insurance: Boolean(body.insurance),
        status: 'reserved',
        notes: String(body.notes ?? '').slice(0, 300),
        createdAt: new Date().toISOString(),
      };
      db.bookings.push(booking);
      persist();
      return { booking: bookingView(booking) };
    },
  },
  {
    method: 'POST',
    path: '/api/bookings/:id/status',
    handler: ({ params, body, ...ctx }) => {
      const user = requireUser(ctx);
      const booking = load().bookings.find((b) => b.id === params.id);
      if (!booking) throw new HttpError(404, 'Booking not found.');
      if (user.role !== 'admin' && booking.userId !== user.id) throw new HttpError(403, 'Not your booking.');

      const next = String(body.status ?? '');
      const allowed = {
        reserved: ['picked_up', 'cancelled'],
        picked_up: ['returned', 'overdue'],
        overdue: ['returned'],
        returned: [],
        cancelled: [],
      };
      if (!allowed[booking.status]?.includes(next)) {
        throw bad(`Cannot move a ${booking.status.replace('_', ' ')} booking to ${next.replace('_', ' ')}.`);
      }
      if (user.role !== 'admin' && next !== 'cancelled') throw new HttpError(403, 'Only staff can do that.');

      booking.status = next;
      if (next === 'picked_up') booking.pickedUpAt = new Date().toISOString();
      if (next === 'returned') booking.returnedAt = new Date().toISOString();
      if (next === 'cancelled') booking.cancelledAt = new Date().toISOString();
      persist();
      return { booking: bookingView(booking) };
    },
  },

  // ---- staff dashboard
  {
    method: 'GET',
    path: '/api/stats',
    handler: (ctx) => {
      requireAdmin(ctx);
      refreshOverdue();
      const { bookings, cameras } = load();
      const revenue = bookings
        .filter((b) => b.status !== 'cancelled')
        .reduce((sum, b) => sum + quote(b.items, b.startDate, b.endDate, b.insurance).total, 0);
      const d = today();
      const unitsOut = bookings
        .filter((b) => ['picked_up', 'overdue'].includes(b.status))
        .reduce((n, b) => n + b.items.reduce((m, i) => m + i.qty, 0), 0);
      const totalUnits = cameras.reduce((n, c) => n + c.stock, 0);

      const byStatus = {};
      for (const b of bookings) byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;

      const popularity = new Map();
      for (const b of bookings) {
        if (b.status === 'cancelled') continue;
        for (const it of b.items) popularity.set(it.name, (popularity.get(it.name) ?? 0) + it.qty);
      }

      return {
        revenue: Math.round(revenue * 100) / 100,
        bookings: bookings.length,
        byStatus,
        unitsOut,
        totalUnits,
        utilisation: totalUnits ? Math.round((unitsOut / totalUnits) * 100) : 0,
        dueToday: bookings.filter((b) => b.endDate === d && ['picked_up', 'overdue'].includes(b.status)).length,
        pickupsToday: bookings.filter((b) => b.startDate === d && b.status === 'reserved').length,
        topItems: [...popularity.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([name, count]) => ({ name, count })),
      };
    },
  },
  {
    method: 'POST',
    path: '/api/admin/reset',
    handler: (ctx) => {
      requireAdmin(ctx);
      resetDb();
      return { ok: true, message: 'Demo data restored.' };
    },
  },
];

export { HttpError };
