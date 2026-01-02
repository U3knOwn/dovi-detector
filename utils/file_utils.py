"""
File utility functions for cleaning up files
"""
import os
import shutil


def cleanup_temp_directory(temp_dir):
    """Clean up temporary directory to prevent accumulation of orphaned files"""
    try:
        if os.path.exists(temp_dir):
            for item in os.listdir(temp_dir):
                item_path = os.path.join(temp_dir, item)
                try:
                    if os.path.isfile(item_path) or os.path.islink(item_path):
                        os.unlink(item_path)
                    elif os.path.isdir(item_path):
                        shutil.rmtree(item_path)
                except Exception as e:
                    print(f"Error deleting {item_path}: {e}")
            print(f"Cleaned up temp directory: {temp_dir}")
    except Exception as e:
        print(f"Error cleaning temp directory: {e}")
