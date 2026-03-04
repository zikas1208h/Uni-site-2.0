const express = require('express');
const router = express.Router();
const multer = require('multer');
const archiver = require('archiver');
const Submission = require('../models/Submission');
const Assignment = require('../models/Assignment');
const User = require('../models/User');
const { auth, isAdmin, isSuperAdmin } = require('../middleware/auth');
const { sendError } = require('../utils/errorResponse');
const { uploadToCloudinary, deleteFromCloudinary, isCloudinaryConfigured } = require('../utils/cloudinary');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/zip', 'application/x-zip-compressed'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only PDF, DOC, DOCX, ZIP files are allowed'));
  },
});

const extractId = (c) => (c._id || c).toString();
const canAccessCourse = (user, courseId) => {
  if (isSuperAdmin(user)) return true;
  const assigned = (user.assignedCourses || []).map(extractId);
  return assigned.includes(courseId?.toString());
};

// â”€â”€ POST /submissions  â€” student submits a file â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const { assignmentId } = req.body;
    if (!assignmentId) return res.status(400).json({ message: 'assignmentId is required' });

    const assignment = await Assignment.findById(assignmentId).lean();
    if (!assignment) return res.status(404).json({ message: 'Assignment not found' });

    if (assignment.submissionType !== 'upload') {
      return res.status(400).json({ message: 'This assignment does not accept file uploads' });
    }

    // Check deadline
    if (new Date() > new Date(assignment.deadline)) {
      return res.status(400).json({ message: 'The submission deadline has passed' });
    }

    // Upload file — Cloudinary if configured, legacy base64 fallback
    let fileData = null, fileUrl = null, cloudinaryPublicId = null;
    if (isCloudinaryConfigured()) {
      const result = await uploadToCloudinary(req.file.buffer, {
        folder: 'submissions',
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
      });
      fileUrl = result.url;
      cloudinaryPublicId = result.publicId;
    } else {
      fileData = req.file.buffer.toString('base64');
    }

    const submission = await Submission.findOneAndUpdate(
      { assignment: assignmentId, student: req.userId },
      {
        assignment: assignmentId,
        student: req.userId,
        course: assignment.course,
        fileName:           req.file.originalname,
        fileSize:           req.file.size,
        fileData:           fileData,
        fileUrl:            fileUrl,
        cloudinaryPublicId: cloudinaryPublicId,
        fileMimeType:       req.file.mimetype,
        status:             'submitted',
        submittedAt:        new Date(),
      },
      { upsert: true, new: true }
    );

    // Return without fileData
    const { fileData: _, ...safe } = submission.toObject();
    res.status(201).json(safe);
  } catch (e) {
    if (e.code === 11000) {
      return res.status(409).json({ message: 'You already submitted â€” resubmit to replace' });
    }
    return sendError(res, 500, 'Error submitting', e);
  }
});

// â”€â”€ GET /submissions/my/:assignmentId  â€” student: check own submission â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/my/:assignmentId', auth, async (req, res) => {
  try {
    const sub = await Submission.findOne({
      assignment: req.params.assignmentId,
      student: req.userId,
    }).select('-fileData').lean();
    if (!sub) return res.status(404).json({ message: 'No submission found' });
    res.json(sub);
  } catch (e) {
    return sendError(res, 500, 'Error fetching submission', e);
  }
});

// â”€â”€ GET /submissions/assignment/:assignmentId  â€” staff: list all submissions â”€â”€
router.get('/assignment/:assignmentId', auth, isAdmin, async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.assignmentId).lean();
    if (!assignment) return res.status(404).json({ message: 'Assignment not found' });

    if (!canAccessCourse(req.user, assignment.course)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const submissions = await Submission.find({ assignment: req.params.assignmentId })
      .select('-fileData')
      .populate('student', 'firstName lastName studentId email')
      .sort({ submittedAt: -1 })
      .lean();

    res.json(submissions);
  } catch (e) {
    return sendError(res, 500, 'Error fetching submissions', e);
  }
});

// â”€â”€ GET /submissions/download/:id  â€” download a submission file â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/download/:id', auth, async (req, res) => {
  try {
    const sub = await Submission.findById(req.params.id);
    if (!sub) return res.status(404).json({ message: 'Submission not found' });

    const isOwner = sub.student.toString() === req.userId.toString();
    if (!isOwner) {
      const assignment = await Assignment.findById(sub.assignment).lean();
      if (!canAccessCourse(req.user, assignment?.course)) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    // NEW: Cloudinary — just redirect
    if (sub.fileUrl && sub.fileUrl.startsWith('http')) {
      return res.redirect(302, sub.fileUrl);
    }
    // LEGACY: base64 in MongoDB
    if (!sub.fileData) return res.status(404).json({ message: 'File not found' });
    const buffer = Buffer.from(sub.fileData, 'base64');
    res.setHeader('Content-Type', sub.fileMimeType || 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(sub.fileName)}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (e) {
    return sendError(res, 500, 'Error downloading', e);
  }
});

// â”€â”€ PATCH /submissions/:id/feedback  â€” staff: add feedback/marks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.patch('/:id/feedback', auth, isAdmin, async (req, res) => {
  try {
    const { feedback, marks } = req.body;
    const sub = await Submission.findById(req.params.id);
    if (!sub) return res.status(404).json({ message: 'Submission not found' });

    const assignment = await Assignment.findById(sub.assignment).lean();
    if (!canAccessCourse(req.user, assignment?.course)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (feedback !== undefined) sub.feedback = feedback;
    if (marks !== undefined) sub.marks = marks;
    sub.status = marks != null ? 'graded' : 'reviewed';
    await sub.save();

    const { fileData: _, ...safe } = sub.toObject();
    res.json(safe);
  } catch (e) {
    return sendError(res, 500, 'Error saving feedback', e);
  }
});

// ── GET /submissions/assignment/:assignmentId/download-all ──────────────────
// Staff: download all submissions for a past-deadline assignment as a ZIP
router.get('/assignment/:assignmentId/download-all', auth, isAdmin, async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.assignmentId)
      .populate('course', 'courseCode courseName').lean();
    if (!assignment) return res.status(404).json({ message: 'Assignment not found' });

    if (!canAccessCourse(req.user, assignment.course?._id || assignment.course)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Only allow after deadline
    if (new Date() < new Date(assignment.deadline)) {
      return res.status(400).json({ message: 'Deadline has not passed yet. Download available after deadline.' });
    }

    const submissions = await Submission.find({ assignment: req.params.assignmentId })
      .populate('student', 'firstName lastName studentId')
      .lean();

    if (!submissions.length) {
      return res.status(404).json({ message: 'No submissions found for this assignment' });
    }

    const safeTitle = (assignment.title || 'assignment').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 40);
    const courseCode = (assignment.course?.courseCode || 'COURSE').replace(/[^a-zA-Z0-9]/g, '_');
    const zipName = `${courseCode}_${safeTitle}_submissions.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => { if (!res.headersSent) res.status(500).json({ message: err.message }); });
    archive.pipe(res);

    for (const sub of submissions) {
      const sName = sub.student
        ? `${sub.student.studentId || 'unknown'}_${sub.student.firstName || ''}_${sub.student.lastName || ''}`
        : 'unknown_student';
      const safeSName = sName.replace(/[^a-zA-Z0-9_\-]/g, '_');
      const ext = sub.fileName ? sub.fileName.split('.').pop() : 'bin';

      // NEW: Cloudinary — fetch file buffer from URL
      if (sub.fileUrl && sub.fileUrl.startsWith('http')) {
        try {
          const https = require('https');
          const http = require('http');
          const fetcher = sub.fileUrl.startsWith('https') ? https : http;
          const buf = await new Promise((resolve, reject) => {
            fetcher.get(sub.fileUrl, (r) => {
              const chunks = [];
              r.on('data', c => chunks.push(c));
              r.on('end', () => resolve(Buffer.concat(chunks)));
              r.on('error', reject);
            }).on('error', reject);
          });
          archive.append(buf, { name: `${safeSName}.${ext}` });
        } catch { /* skip this submission if fetch fails */ }
        continue;
      }
      // LEGACY: base64
      if (!sub.fileData) continue;
      const buf = Buffer.from(sub.fileData, 'base64');
      archive.append(buf, { name: `${safeSName}.${ext}` });
    }

    await archive.finalize();
  } catch (e) {
    if (!res.headersSent) return sendError(res, 500, 'Error creating archive', e);
  }
});

// ── PATCH /submissions/assignment/:assignmentId/grade-all ───────────────────
// Staff: mark all submissions for an assignment as 'reviewed' (batch status update)
router.patch('/assignment/:assignmentId/grade-all', auth, isAdmin, async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.assignmentId).lean();
    if (!assignment) return res.status(404).json({ message: 'Assignment not found' });

    if (!canAccessCourse(req.user, assignment.course)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (new Date() < new Date(assignment.deadline)) {
      return res.status(400).json({ message: 'Deadline has not passed yet.' });
    }

    const result = await Submission.updateMany(
      { assignment: req.params.assignmentId, status: 'submitted' },
      { $set: { status: 'reviewed' } }
    );

    res.json({ message: `Marked ${result.modifiedCount} submission(s) as reviewed.`, modifiedCount: result.modifiedCount });
  } catch (e) {
    return sendError(res, 500, 'Error marking submissions', e);
  }
});

module.exports = router;

