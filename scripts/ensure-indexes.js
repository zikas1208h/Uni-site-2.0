/**
 * MongoDB Index Audit & Creation Script
 * Run with: node scripts/ensure-indexes.js
 *
 * Sized for 5,000 students:
 * - Compound indexes on all high-traffic query patterns
 * - Covers notifications, grades, submissions, materials, assignments
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function ensureIndexes() {
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected\n');

  const db = mongoose.connection.db;

  const indexes = [
    // ── Notifications ─────────────────────────────────────────────────────────
    // Students poll this on every login — must be instant
    {
      col: 'notifications',
      index: { recipient: 1, isRead: 1, createdAt: -1 },
      opts: { name: 'recipient_read_date', background: true },
    },
    {
      col: 'notifications',
      index: { recipient: 1, createdAt: -1 },
      opts: { name: 'recipient_date', background: true },
    },

    // ── Grades ────────────────────────────────────────────────────────────────
    // GPA query: find all grades for student
    {
      col: 'grades',
      index: { student: 1, isFinalized: 1 },
      opts: { name: 'student_finalized', background: true },
    },
    // Admin grade stats: aggregate by course
    {
      col: 'grades',
      index: { course: 1, grade: 1 },
      opts: { name: 'course_grade_dist', background: true },
    },
    // Student grade history by semester
    {
      col: 'grades',
      index: { student: 1, year: -1, semester: 1 },
      opts: { name: 'student_semester', background: true },
    },

    // ── Submissions ───────────────────────────────────────────────────────────
    // Staff checking all submissions for an assignment
    {
      col: 'submissions',
      index: { assignment: 1, submittedAt: -1 },
      opts: { name: 'assignment_submittedAt', background: true },
    },
    // Student checking their own submission
    {
      col: 'submissions',
      index: { assignment: 1, student: 1 },
      opts: { name: 'assignment_student', unique: true, background: true },
    },
    // Download-all: find all submissions for an assignment (with fileData for ZIP)
    {
      col: 'submissions',
      index: { assignment: 1, status: 1 },
      opts: { name: 'assignment_status', background: true },
    },

    // ── Materials ─────────────────────────────────────────────────────────────
    // Course materials list — CRITICAL: exclude fileData from index (it's huge)
    {
      col: 'materials',
      index: { course: 1, createdAt: -1 },
      opts: { name: 'course_date', background: true },
    },
    {
      col: 'materials',
      index: { course: 1, type: 1, createdAt: -1 },
      opts: { name: 'course_type_date', background: true },
    },

    // ── Assignments ───────────────────────────────────────────────────────────
    // Student assignment list (my courses)
    {
      col: 'assignments',
      index: { course: 1, deadline: 1 },
      opts: { name: 'course_deadline', background: true },
    },
    // Exam announcements query
    {
      col: 'assignments',
      index: { course: 1, examType: 1, deadline: 1 },
      opts: { name: 'course_examtype_deadline', background: true },
    },

    // ── Users ─────────────────────────────────────────────────────────────────
    // Student search by ID or name
    {
      col: 'users',
      index: { studentId: 1 },
      opts: { name: 'studentId', sparse: true, background: true },
    },
    {
      col: 'users',
      index: { role: 1, createdAt: -1 },
      opts: { name: 'role_date', background: true },
    },
    // Enrollment queries (who is in a course)
    {
      col: 'users',
      index: { enrolledCourses: 1 },
      opts: { name: 'enrolledCourses', background: true },
    },

    // ── Courses ───────────────────────────────────────────────────────────────
    {
      col: 'courses',
      index: { status: 1, year: 1, semester: 1 },
      opts: { name: 'status_year_semester', background: true },
    },
    {
      col: 'courses',
      index: { major: 1, year: 1, semester: 1 },
      opts: { name: 'major_year_semester', background: true },
    },
  ];

  let created = 0, skipped = 0, errors = 0;

  for (const { col, index, opts } of indexes) {
    try {
      await db.collection(col).createIndex(index, opts);
      console.log(`  ✅ ${col}: ${opts.name}`);
      created++;
    } catch (e) {
      if (e.code === 85 || e.code === 86 || e.message?.includes('already exists') || e.message?.includes('IndexKeySpecsConflict')) {
        console.log(`  ⏭  ${col}: ${opts.name} (already exists)`);
        skipped++;
      } else {
        console.error(`  ❌ ${col}: ${opts.name} — ${e.message}`);
        errors++;
      }
    }
  }

  console.log(`\n📊 Summary: ${created} created, ${skipped} skipped, ${errors} errors`);

  // Check collection stats
  console.log('\n📦 Collection sizes:');
  for (const col of ['notifications','grades','submissions','materials','assignments','users','courses']) {
    try {
      const stats = await db.collection(col).estimatedDocumentCount();
      console.log(`  ${col}: ~${stats.toLocaleString()} documents`);
    } catch {}
  }

  await mongoose.disconnect();
  console.log('\n✅ Done');
}

ensureIndexes().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});

