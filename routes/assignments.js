const express = require('express');
const router = express.Router();
const multer = require('multer');
const Assignment = require('../models/Assignment');
const Course = require('../models/Course');
const User = require('../models/User');
const Grade = require('../models/Grade');
const Notification = require('../models/Notification');
const { auth, isAdmin, isSuperAdmin } = require('../middleware/auth');
const { sendError } = require('../utils/errorResponse');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const extractId = (c) => (c._id || c).toString();
const canAccessCourse = (user, courseId) => {
  if (isSuperAdmin(user)) return true;
  const assigned = (user.assignedCourses || []).map(extractId);
  return assigned.includes(courseId?.toString());
};

// â”€â”€ Helper: collect all student IDs who have ever been in a course â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Checks both enrolledCourses (active) AND Grade records (already graded/completed)
const getStudentsForCourse = async (courseId) => {
  const [enrolledUsers, grades, courseDoc] = await Promise.all([
    User.find({ role: 'student', enrolledCourses: courseId }, { _id: 1 }).lean(),
    Grade.find({ course: courseId }, { student: 1 }).lean(),
    Course.findById(courseId).select('enrolledStudents').lean(),
  ]);

  const idSet = new Set();
  enrolledUsers.forEach(u => idSet.add(u._id.toString()));
  grades.forEach(g => idSet.add(g.student.toString()));
  (courseDoc?.enrolledStudents || []).forEach(id => idSet.add(id.toString()));
  return Array.from(idSet);
};

// â”€â”€ Helper: fan-out notifications â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const notifyEnrolledStudents = async ({ courseId, type, title, message, assignmentId = null, materialId = null }) => {
  try {
    const studentIds = await getStudentsForCourse(courseId);
    if (!studentIds.length) return;

    const docs = studentIds.map(id => ({
      recipient: id, type, title, message,
      course: courseId,
      assignment: assignmentId || null,
      material: materialId || null,
    }));
    await Notification.insertMany(docs, { ordered: false });
  } catch (e) {
    console.error('Notification fan-out error:', e.message);
  }
};


// ── GET /assignments/course/:courseId/components — get all assignments for a course as grade components
router.get('/course/:courseId/components', auth, isAdmin, async (req, res) => {
  try {
    const assignments = await Assignment.find({ course: req.params.courseId })
      .select('_id title examType isAnnouncement totalMarks deadline semester year studentScores')
      .sort({ deadline: 1 })
      .lean();
    // Map each assignment to a component descriptor
    const components = assignments.map(a => ({
      assignmentId: a._id,
      name: a.title,
      type: a.examType !== 'none' ? a.examType : 'assignment',
      maxScore: a.totalMarks || 100,
      weight: a.totalMarks || 100, // default weight = maxScore, can be overridden
      deadline: a.deadline,
      semester: a.semester,
      year: a.year,
      studentScores: a.studentScores || {},
    }));
    res.json(components);
  } catch (e) {
    return sendError(res, 500, 'Error fetching course components', e);
  }
});

// ── PATCH /assignments/:id/grade-student — grade a single student on this assignment
router.patch('/:id/grade-student', auth, isAdmin, async (req, res) => {
  try {
    const { studentId, score } = req.body;
    if (!studentId || score == null) return res.status(400).json({ message: 'studentId and score are required' });

    const assignment = await Assignment.findById(req.params.id);
    if (!assignment) return res.status(404).json({ message: 'Assignment not found' });
    if (!canAccessCourse(req.user, assignment.course))
      return res.status(403).json({ message: 'You do not have access to this course' });
    if (score < 0 || score > assignment.totalMarks)
      return res.status(400).json({ message: `Score must be between 0 and ${assignment.totalMarks}` });

    // Store score on assignment
    if (!assignment.studentScores) assignment.studentScores = new Map();
    assignment.studentScores.set(studentId, {
      score: Number(score),
      gradedAt: new Date(),
      gradedBy: req.userId,
    });
    await assignment.save();

    res.json({ message: 'Score saved', assignmentId: assignment._id, studentId, score: Number(score) });
  } catch (e) {
    return sendError(res, 500, 'Error grading student', e);
  }
});

// ── GET /assignments/my  — student: assignments for all their courses ────────
router.get('/my', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('enrolledCourses').lean();

    // Get course IDs from both enrolledCourses AND Grade records
    // (grades route removes student from enrolledCourses, so we must check both)
    const grades = await Grade.find({ student: req.userId }, { course: 1 }).lean();
    const courseIdSet = new Set([
      ...(user.enrolledCourses || []).map(id => id.toString()),
      ...grades.map(g => g.course.toString()),
    ]);

    if (!courseIdSet.size) return res.json([]);

    const assignments = await Assignment.find({ course: { $in: Array.from(courseIdSet) } })
      .populate('course', 'courseCode courseName')
      .sort({ deadline: 1 })
      .lean();

    const safe = assignments.map(({ fileData, ...rest }) => rest);
    res.json(safe);
  } catch (e) {
    return sendError(res, 500, 'Error fetching assignments', e);
  }
});

// â”€â”€ GET /assignments/staff  â€” doctor/assistant: their course assignments â”€â”€â”€â”€â”€
router.get('/staff', auth, isAdmin, async (req, res) => {
  try {
    let query = {};
    if (!isSuperAdmin(req.user)) {
      const assigned = (req.user.assignedCourses || []).map(extractId);
      if (!assigned.length) return res.json([]);
      query.course = { $in: assigned };
    }
    const assignments = await Assignment.find(query)
      .populate('course', 'courseCode courseName')
      .sort({ deadline: 1 })
      .lean();
    const safe = assignments.map(({ fileData, ...rest }) => rest);
    res.json(safe);
  } catch (e) {
    return sendError(res, 500, 'Error fetching assignments', e);
  }
});

// â”€â”€ GET /assignments/download/:id â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/download/:id', auth, async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id);
    if (!assignment || !assignment.fileData)
      return res.status(404).json({ message: 'No file attached to this assignment' });

    const buffer = Buffer.from(assignment.fileData, 'base64');
    res.setHeader('Content-Type', assignment.fileMimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(assignment.fileName)}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (e) {
    return sendError(res, 500, 'Error downloading file', e);
  }
});

// â”€â”€ GET /assignments/:id  â€” detail â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/:id', auth, async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id).populate('course', 'courseCode courseName').lean();
    if (!assignment) return res.status(404).json({ message: 'Assignment not found' });
    const { fileData, ...safe } = assignment;
    res.json(safe);
  } catch (e) {
    return sendError(res, 500, 'Error fetching assignment', e);
  }
});

// â”€â”€ POST /assignments  â€” create (staff) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/', auth, isAdmin, upload.single('file'), async (req, res) => {
  try {
    const {
      course, title, description, submissionType, submissionDetails,
      submissionLink, deadline, totalMarks, semester, year,
      examType, materialsCovered, examDuration, examLocation, isAnnouncement,
    } = req.body;

    if (!canAccessCourse(req.user, course))
      return res.status(403).json({ message: 'You do not have access to this course' });

    const courseDoc = await Course.findById(course).select('courseCode courseName').lean();
    if (!courseDoc) return res.status(404).json({ message: 'Course not found' });

    const assignmentData = {
      course, title, description,
      submissionType: submissionType || 'none',
      submissionDetails: submissionDetails || '',
      submissionLink: submissionLink || '',
      deadline: new Date(deadline),
      totalMarks: totalMarks ? Number(totalMarks) : 100,
      uploadedBy: req.userId,
      semester: semester || 'Spring',
      year: year ? Number(year) : new Date().getFullYear(),
      examType: examType || 'none',
      materialsCovered: materialsCovered || '',
      examDuration: examDuration ? Number(examDuration) : null,
      examLocation: examLocation || '',
      isAnnouncement: isAnnouncement === 'true' || isAnnouncement === true,
    };

    if (req.file) {
      assignmentData.fileName    = req.file.originalname;
      assignmentData.filePath    = `assignments/${Date.now()}-${req.file.originalname}`;
      assignmentData.fileSize    = req.file.size;
      assignmentData.fileData    = req.file.buffer.toString('base64');
      assignmentData.fileMimeType= req.file.mimetype;
    }

    const assignment = await Assignment.create(assignmentData);

    // Fan-out notification
    const deadlineStr = new Date(deadline).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
    const isExamAnnouncement = assignmentData.isAnnouncement;
    const notifTitle = isExamAnnouncement
      ? `ًں“… ${examType !== 'none' ? examType.charAt(0).toUpperCase()+examType.slice(1) : 'Exam'} Announcement: ${title}`
      : `ًں“‌ New Assignment: ${title}`;
    const notifMessage = isExamAnnouncement
      ? `${courseDoc.courseCode} â€” ${courseDoc.courseName}: ${title} on ${deadlineStr}${materialsCovered ? `. Covers: ${materialsCovered}` : ''}`
      : `New assignment posted for ${courseDoc.courseCode} â€” ${courseDoc.courseName}. Deadline: ${deadlineStr}`;

    await notifyEnrolledStudents({
      courseId: course,
      type: isExamAnnouncement ? 'announcement' : 'assignment',
      title: notifTitle,
      message: notifMessage,
      assignmentId: assignment._id,
    });

    const { fileData: _, ...safeAssignment } = assignment.toObject();
    res.status(201).json(safeAssignment);
  } catch (e) {
    return sendError(res, 500, 'Error creating assignment', e);
  }
});

// â”€â”€ PUT /assignments/:id  â€” update (staff) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.put('/:id', auth, isAdmin, upload.single('file'), async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id);
    if (!assignment) return res.status(404).json({ message: 'Assignment not found' });
    if (!canAccessCourse(req.user, assignment.course))
      return res.status(403).json({ message: 'You do not have access to this course' });

    const fields = ['title', 'description', 'submissionType', 'submissionDetails', 'submissionLink', 'deadline', 'totalMarks', 'semester', 'year'];
    fields.forEach(f => { if (req.body[f] !== undefined) assignment[f] = req.body[f]; });

    if (req.file) {
      assignment.fileName = req.file.originalname;
      assignment.filePath = `assignments/${Date.now()}-${req.file.originalname}`;
      assignment.fileSize = req.file.size;
      assignment.fileData = req.file.buffer.toString('base64');
      assignment.fileMimeType = req.file.mimetype;
    }
    await assignment.save();
    const { fileData: _, ...safe } = assignment.toObject();
    res.json(safe);
  } catch (e) {
    return sendError(res, 500, 'Error updating assignment', e);
  }
});

// â”€â”€ DELETE /assignments/:id  â€” delete (staff) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.delete('/:id', auth, isAdmin, async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id);
    if (!assignment) return res.status(404).json({ message: 'Assignment not found' });
    if (!canAccessCourse(req.user, assignment.course))
      return res.status(403).json({ message: 'You do not have access to this course' });
    await Assignment.findByIdAndDelete(req.params.id);
    res.json({ message: 'Assignment deleted' });
  } catch (e) {
    return sendError(res, 500, 'Error deleting assignment', e);
  }
});

router.notifyEnrolledStudents = notifyEnrolledStudents;
module.exports = router;

