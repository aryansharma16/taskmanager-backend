import { v2 as cloudinary } from 'cloudinary';

// Configure Cloudinary
// It will automatically pick up the CLOUDINARY_URL environment variable if set.
// You can also explicitly configure it:
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Uploads a file (local path or base64 string) to Cloudinary
 * @param {string} filePath - Local file path or base64 data URI
 * @param {string} folder - Destination folder in Cloudinary
 * @returns {Promise<Object>} Upload result containing URL and public ID
 */
export const uploadToCloudinary = async (filePath, folder = 'taskmanager') => {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder: folder,
      resource_type: 'auto', // Auto detects image, raw (PDF/Doc), or video
    });
    
    return {
      url: result.secure_url,
      publicId: result.public_id,
      format: result.format,
      bytes: result.bytes,
    };
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    throw new Error('Failed to upload file to Cloudinary');
  }
};

/**
 * Deletes a file from Cloudinary (useful when a user deletes a task attachment)
 * @param {string} publicId - The public ID of the file to delete
 * @returns {Promise<void>}
 */
export const deleteFromCloudinary = async (publicId) => {
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error('Cloudinary delete error:', error);
    throw new Error('Failed to delete file from Cloudinary');
  }
};
