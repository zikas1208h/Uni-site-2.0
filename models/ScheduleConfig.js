const mongoose = require('mongoose');

/**
 * Global schedule configuration — set once by superadmin.
 * Stored as a single document (singleton pattern).
 *
 * This is the "algorithm input" document. The schedule generator
 * reads this to know:
 *   - what rooms / amphitheatres exist and their capacity
 *   - how long each session type lasts
 *   - how many sessions per day are allowed
 *   - which days are working days
 *   - time bounds (earliest start, latest end)
 */
const roomSchema = new mongoose.Schema({
  name:     { type: String, required: true }, // e.g. "Room 101", "Amphitheatre A"
  type:     { type: String, enum: ['room','amphitheatre','lab'], default: 'room' },
  capacity: { type: Number, default: 40 },
}, { _id: false });

const scheduleConfigSchema = new mongoose.Schema({
  // ── Working days ──────────────────────────────────────────────────────────
  workingDays: {
    type: [String],
    default: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Saturday'],
  },

  // ── Daily time window ─────────────────────────────────────────────────────
  dayStartTime: { type: String, default: '08:00' },  // earliest slot start
  dayEndTime:   { type: String, default: '18:00' },  // latest slot end

  // ── Break between sessions (minutes) ─────────────────────────────────────
  breakBetweenSlots: { type: Number, default: 15 },

  // ── Session durations (minutes) ───────────────────────────────────────────
  lectureDuration:  { type: Number, default: 90  },  // 1.5 h
  sectionDuration:  { type: Number, default: 90  },  // 1.5 h
  labDuration:      { type: Number, default: 120 },  // 2 h  (not used yet)

  // ── Max sessions per type per day (0 = unlimited) ─────────────────────────
  maxLecturesPerDay:  { type: Number, default: 2 },
  maxSectionsPerDay:  { type: Number, default: 2 },

  // ── Max sessions per student per day (all types combined) ─────────────────
  maxSlotsPerStudentPerDay: { type: Number, default: 4 },

  // ── Rooms & amphitheatres available ───────────────────────────────────────
  rooms: { type: [roomSchema], default: [] },

  // ── Semester this config is for ───────────────────────────────────────────
  semester: { type: String, default: 'Spring' },
  year:     { type: Number, default: 2026 },

  // ── Config version — bump whenever superadmin saves ───────────────────────
  version: { type: Number, default: 1 },
}, { timestamps: true });

module.exports = mongoose.model('ScheduleConfig', scheduleConfigSchema);

