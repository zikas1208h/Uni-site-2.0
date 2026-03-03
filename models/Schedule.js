const mongoose = require('mongoose');

// One slot in a weekly timetable
const slotSchema = new mongoose.Schema({
  day:        { type: String, required: true }, // 'Sunday' … 'Thursday'
  startTime:  { type: String, required: true }, // '08:00'
  endTime:    { type: String, required: true }, // '09:30'
  type:       { type: String, enum: ['lecture','section','lab'], required: true },
  venue:      { type: String, default: '' },
  venueType:  { type: String, enum: ['amphitheatre','lab','room',''], default: '' },
  courseCode: { type: String, default: '' },
  courseName: { type: String, default: '' },
  courseId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Course', default: null },
  staffId:    { type: String, default: '' },
  staffName:  { type: String, default: '' },
  staffRole:  { type: String, enum: ['doctor','assistant',''], default: '' },
  group:      { type: Number, default: null },  // lecture group number
  section:    { type: Number, default: null },  // section number (1 or 2)
}, { _id: false });

// ── Master schedule (one per semester, global) ─────────────────────────────
const masterScheduleSchema = new mongoose.Schema({
  semester:    { type: String, required: true },
  year:        { type: Number, required: true },
  slots:       [slotSchema],
  warnings:    [{ type: String }],
  generatedAt: { type: Date, default: Date.now },
  configVersion: { type: Number, default: 1 },
}, { timestamps: true });

// ── Per-student schedule (filtered view of master) ─────────────────────────
const scheduleSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,   // one schedule per student
  },
  semester: { type: String, required: true },
  year:     { type: Number, required: true },
  slots:    [slotSchema],
  // Which config version generated this (so re-generate if config changes)
  configVersion: { type: Number, default: 1 },
  generatedAt:   { type: Date, default: Date.now },
}, { timestamps: true });

scheduleSchema.index({ student: 1 });
masterScheduleSchema.index({ semester: 1, year: 1 });

const Schedule       = mongoose.model('Schedule',       scheduleSchema);
const MasterSchedule = mongoose.model('MasterSchedule', masterScheduleSchema);

module.exports = { Schedule, MasterSchedule };
