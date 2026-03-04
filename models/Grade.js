const mongoose = require('mongoose');

// ── Letter grade scale (unchanged) ────────────────────────────────────────────
const calcLetterGradeFromTotal = (total) => {
  if (total >= 96) return { grade: 'A+', gradePoint: 4.0 };
  if (total >= 92) return { grade: 'A',  gradePoint: 3.7 };
  if (total >= 88) return { grade: 'A-', gradePoint: 3.4 };
  if (total >= 84) return { grade: 'B+', gradePoint: 3.2 };
  if (total >= 80) return { grade: 'B',  gradePoint: 3.0 };
  if (total >= 76) return { grade: 'B-', gradePoint: 2.8 };
  if (total >= 72) return { grade: 'C+', gradePoint: 2.6 };
  if (total >= 68) return { grade: 'C',  gradePoint: 2.4 };
  if (total >= 64) return { grade: 'C-', gradePoint: 2.2 };
  if (total >= 60) return { grade: 'D+', gradePoint: 2.0 };
  if (total >= 55) return { grade: 'D',  gradePoint: 1.5 };
  if (total >= 50) return { grade: 'D-', gradePoint: 1.0 };
  return               { grade: 'F',  gradePoint: 0.0 };
};

const RETAKE_MAX_SCORE = 83;
const applyRetakeCap = (total) => {
  const cappedTotal = Math.min(total != null ? total : 0, RETAKE_MAX_SCORE);
  return calcLetterGradeFromTotal(cappedTotal);
};

// ── Classwork entry schema ─────────────────────────────────────────────────────
// Assignments and quizzes live here — raw marks only, NO GPA effect.
// Auto-added when assignment/exam is created; locked after first grade, edit-only after.
const classworkEntrySchema = new mongoose.Schema({
  assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment', default: null },
  name:         { type: String, required: true },
  type:         { type: String, enum: ['quiz', 'assignment', 'midterm', 'practical', 'other'], default: 'assignment' },
  maxScore:     { type: Number, min: 1, default: 100 },
  score:        { type: Number, min: 0, default: null },     // null = not yet graded
  isGraded:     { type: Boolean, default: false },            // once true, can only edit
  gradedAt:     { type: Date, default: null },
  gradedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { _id: false });

// ── Semester grade schema ──────────────────────────────────────────────────────
// Holds midterm + final scores (each out of their own maxScore, doctor sets them).
