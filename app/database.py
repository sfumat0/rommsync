"""
Database module for managing local ROM hash cache
"""
import sqlite3
import hashlib
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict
import logging

logger = logging.getLogger(__name__)


class Database:
    def __init__(self, db_path: str):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = None
        self._init_db()
    
    def _init_db(self):
        """Initialize database with required tables"""
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        
        cursor = self.conn.cursor()
        
        # Table for local ROM files and their hashes
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS local_roms (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                platform TEXT NOT NULL,
                file_name TEXT NOT NULL,
                file_path TEXT NOT NULL UNIQUE,
                file_size INTEGER NOT NULL,
                sha1_hash TEXT NOT NULL,
                md5_hash TEXT,
                crc_hash TEXT,
                scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_modified TIMESTAMP
            )
        """)
        
        # Index for fast hash lookups
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_sha1 ON local_roms(sha1_hash)
        """)
        
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_platform ON local_roms(platform)
        """)
        
        # Table for scan metadata
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS scan_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                platform TEXT,
                scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                files_scanned INTEGER,
                duration_seconds REAL
            )
        """)
        
        self.conn.commit()
        logger.info(f"Database initialized at {self.db_path}")
    
    def add_local_rom(self, platform: str, file_path: str, file_name: str, 
                      file_size: int, sha1_hash: str, md5_hash: str = None, 
                      crc_hash: str = None, last_modified: datetime = None):
        """Add or update a local ROM file"""
        cursor = self.conn.cursor()
        
        try:
            cursor.execute("""
                INSERT OR REPLACE INTO local_roms 
                (platform, file_name, file_path, file_size, sha1_hash, md5_hash, crc_hash, last_modified, scanned_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """, (platform, file_name, file_path, file_size, sha1_hash, md5_hash, crc_hash, last_modified))
            
            self.conn.commit()
            return cursor.lastrowid
        except sqlite3.Error as e:
            logger.error(f"Error adding ROM to database: {e}")
            return None
    
    def get_local_rom_by_hash(self, sha1_hash: str) -> Optional[Dict]:
        """Check if a ROM with this hash exists locally"""
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT * FROM local_roms WHERE sha1_hash = ?
        """, (sha1_hash,))
        
        row = cursor.fetchone()
        if row:
            return dict(row)
        return None
    
    def get_local_roms_by_platform(self, platform: str) -> List[Dict]:
        """Get all local ROMs for a specific platform"""
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT * FROM local_roms WHERE platform = ? ORDER BY file_name
        """, (platform,))
        
        return [dict(row) for row in cursor.fetchall()]
    
    def get_all_local_roms(self) -> List[Dict]:
        """Get all local ROMs"""
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT * FROM local_roms ORDER BY platform, file_name
        """)
        
        return [dict(row) for row in cursor.fetchall()]
    
    def delete_local_rom(self, file_path: str):
        """Remove a ROM from the database (file was deleted)"""
        cursor = self.conn.cursor()
        cursor.execute("DELETE FROM local_roms WHERE file_path = ?", (file_path,))
        self.conn.commit()
    
    def clear_platform(self, platform: str):
        """Clear all ROMs for a specific platform (before rescan)"""
        cursor = self.conn.cursor()
        cursor.execute("DELETE FROM local_roms WHERE platform = ?", (platform,))
        self.conn.commit()
        logger.info(f"Cleared {cursor.rowcount} ROMs for platform {platform}")
    
    def add_scan_record(self, platform: str, files_scanned: int, duration: float):
        """Record a scan operation"""
        cursor = self.conn.cursor()
        cursor.execute("""
            INSERT INTO scan_history (platform, files_scanned, duration_seconds)
            VALUES (?, ?, ?)
        """, (platform, files_scanned, duration))
        self.conn.commit()
    
    def get_scan_stats(self) -> Dict:
        """Get statistics about the local ROM collection"""
        cursor = self.conn.cursor()
        
        # Total ROMs
        cursor.execute("SELECT COUNT(*) as total FROM local_roms")
        total = cursor.fetchone()['total']
        
        # ROMs by platform
        cursor.execute("""
            SELECT platform, COUNT(*) as count 
            FROM local_roms 
            GROUP BY platform 
            ORDER BY count DESC
        """)
        by_platform = [dict(row) for row in cursor.fetchall()]
        
        # Last scan
        cursor.execute("""
            SELECT * FROM scan_history 
            ORDER BY scanned_at DESC 
            LIMIT 1
        """)
        last_scan = cursor.fetchone()
        if last_scan:
            last_scan = dict(last_scan)
        
        return {
            'total_roms': total,
            'by_platform': by_platform,
            'last_scan': last_scan
        }
    
    def close(self):
        """Close database connection"""
        if self.conn:
            self.conn.close()
            logger.info("Database connection closed")
