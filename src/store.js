// Tiny JSON-file data store. No dependencies: read once, keep in memory, write on change.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedUsers, seedCameras, seedBookings } from './seed.js';

const here = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(here, '..', 'data');
export const DB_PATH = join(DATA_DIR, 'db.json');

let db = null;

function freshDb() {
  const today = new Date();
  return {
    version: 1,
    users: structuredClone(seedUsers),
    cameras: structuredClone(seedCameras),
    bookings: seedBookings(today),
  };
}

export function load() {
  if (db) return db;
  if (existsSync(DB_PATH)) {
    try {
      db = JSON.parse(readFileSync(DB_PATH, 'utf8'));
      // Guard against a half-written or older file.
      if (!db || !Array.isArray(db.cameras) || !Array.isArray(db.bookings)) throw new Error('bad shape');
    } catch {
      console.warn('[store] db.json unreadable, reseeding');
      db = freshDb();
      persist();
    }
  } else {
    db = freshDb();
    persist();
  }
  return db;
}

export function persist() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

export function resetDb() {
  db = freshDb();
  persist();
  return db;
}

export const id = (prefix) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// ---------------------------------------------------------------- dates

export const today = () => new Date().toISOString().slice(0, 10);

export function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

/** Rental days are inclusive: pick up Friday, return Sunday = 3 days. */
export function rentalDays(start, end) {
  const ms = Date.parse(end) - Date.parse(start);
  return Math.floor(ms / 864e5) + 1;
}

export function datesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

// ---------------------------------------------------------------- pricing

export const RATES = {
  taxRate: 0.085,
  insuranceRate: 0.09,
  tiers: [
    { minDays: 14, discount: 0.25, label: 'Fortnight rate (25% off)' },
    { minDays: 7, discount: 0.2, label: 'Weekly rate (20% off)' },
    { minDays: 3, discount: 0.1, label: 'Multi-day rate (10% off)' },
  ],
};

export function discountFor(days) {
  return RATES.tiers.find((t) => days >= t.minDays) ?? { discount: 0, label: 'Daily rate' };
}

const r2 = (n) => Math.round(n * 100) / 100;

/** items: [{ cameraId, name, dailyRate, qty }] */
export function quote(items, startDate, endDate, insurance = false) {
  const days = rentalDays(startDate, endDate);
  const base = items.reduce((sum, it) => sum + it.dailyRate * it.qty * days, 0);
  const tier = discountFor(days);
  const discount = r2(base * tier.discount);
  const afterDiscount = r2(base - discount);
  const insuranceFee = insurance ? r2(afterDiscount * RATES.insuranceRate) : 0;
  const tax = r2((afterDiscount + insuranceFee) * RATES.taxRate);
  const total = r2(afterDiscount + insuranceFee + tax);
  const deposit = items.reduce((sum, it) => {
    const cam = load().cameras.find((c) => c.id === it.cameraId);
    return sum + (cam ? cam.deposit * it.qty : 0);
  }, 0);
  return {
    days,
    base: r2(base),
    discount,
    discountLabel: tier.label,
    discountRate: tier.discount,
    insuranceFee,
    tax,
    total,
    deposit,
    dueNow: r2(total + deposit),
  };
}

// ---------------------------------------------------------------- availability

export const ACTIVE_STATUSES = ['reserved', 'picked_up', 'overdue'];

/** How many units of a camera are already committed over a date range. */
export function bookedUnits(cameraId, startDate, endDate, ignoreBookingId = null) {
  const { bookings } = load();
  let count = 0;
  for (const b of bookings) {
    if (b.id === ignoreBookingId) continue;
    if (!ACTIVE_STATUSES.includes(b.status)) continue;
    if (!datesOverlap(startDate, endDate, b.startDate, b.endDate)) continue;
    for (const it of b.items) if (it.cameraId === cameraId) count += it.qty;
  }
  return count;
}

export function availability(cameraId, startDate, endDate, ignoreBookingId = null) {
  const cam = load().cameras.find((c) => c.id === cameraId);
  if (!cam) return { available: 0, stock: 0, booked: 0 };
  const booked = bookedUnits(cameraId, startDate, endDate, ignoreBookingId);
  return { stock: cam.stock, booked, available: Math.max(0, cam.stock - booked) };
}

/** Mark anything past its return date that is still out as overdue. */
export function refreshOverdue() {
  const d = today();
  let changed = false;
  for (const b of load().bookings) {
    if (b.status === 'picked_up' && b.endDate < d) {
      b.status = 'overdue';
      changed = true;
    }
  }
  if (changed) persist();
}
