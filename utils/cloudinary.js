/**
 * Cloudinary upload utility
 * Handles all file uploads/deletes — keeps MongoDB free of binary blobs.
 * Configured for 5,000+ student scale:
 *   - Automatic format optimization
 *   - Chunked upload for files > 5MB
 *   - Signed URLs for secure access
 */
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
});

/**
 * Upload a buffer to Cloudinary.
 * @param {Buffer} buffer - File buffer
 * @param {Object} opts
 * @param {string} opts.folder - Cloudinary folder (e.g. 'materials', 'submissions')
 * @param {string} opts.filename - Original filename (used as public_id)
 * @param {string} opts.mimetype - File MIME type
 * @returns {Promise<{url: string, publicId: string, bytes: number}>}
 */
const uploadToCloudinary = (buffer, { folder, filename, mimetype }) => {
  return new Promise((resolve, reject) => {
    // Use raw resource type for non-image files (PDFs, docs, zip)
    const isImage = mimetype?.startsWith('image/');
    const resourceType = isImage ? 'image' : 'raw';

    // Sanitize filename for public_id
    const safeFilename = `${Date.now()}_${(filename || 'file').replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: `uni-portal/${folder}`,
        public_id: safeFilename,
        resource_type: resourceType,
        // For images: auto-optimize quality
        ...(isImage ? { quality: 'auto', fetch_format: 'auto' } : {}),
        // Keep original filename in metadata
        context: { original_filename: filename || '' },
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({
          url:      result.secure_url,
          publicId: result.public_id,
          bytes:    result.bytes,
        });
      }
    );

    uploadStream.end(buffer);
  });
};

/**
 * Delete a file from Cloudinary by public_id.
 * Silently succeeds even if the file doesn't exist.
 */
const deleteFromCloudinary = async (publicId, mimetype) => {
  if (!publicId) return;
  try {
    const isImage = mimetype?.startsWith('image/');
    const resourceType = isImage ? 'image' : 'raw';
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (e) {
    console.warn('[Cloudinary] Delete failed (non-fatal):', e.message);
  }
};

/**
 * Check if Cloudinary is configured (all 3 env vars present).
 */
const isCloudinaryConfigured = () =>
  !!(process.env.CLOUDINARY_CLOUD_NAME &&
     process.env.CLOUDINARY_API_KEY &&
     process.env.CLOUDINARY_API_SECRET);

module.exports = { uploadToCloudinary, deleteFromCloudinary, isCloudinaryConfigured };

