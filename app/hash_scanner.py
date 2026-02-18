"""
ROM Scanner
Scans local ROM directories and generates file hashes
"""
import hashlib
from pathlib import Path
from typing import List, Dict, Optional, Callable
from datetime import datetime
import logging
import time

logger = logging.getLogger(__name__)


class RomScanner:
    # Common ROM file extensions by platform
    ROM_EXTENSIONS = {
        'gb': ['.gb'],
        'gbc': ['.gbc'],
        'gba': ['.gba'],
        'nes': ['.nes', '.unf'],
        'snes': ['.sfc', '.smc'],
        'n64': ['.n64', '.z64', '.v64'],
        'gc': ['.iso', '.gcm', '.rvz'],
        'wii': ['.iso', '.wbfs', '.rvz'],
        'psx': ['.bin', '.cue', '.chd', '.pbp', '.iso'],
        'ps2': ['.iso', '.bin', '.chd'],
        'psp': ['.iso', '.cso'],
        'megadrive': ['.md', '.smd', '.gen', '.bin'],
        'mastersystem': ['.sms'],
        'gamegear': ['.gg'],
        'dreamcast': ['.cdi', '.gdi', '.chd'],
        'atari2600': ['.a26', '.bin'],
        'atari7800': ['.a78'],
        'atarilynx': ['.lnx'],
        'pcengine': ['.pce', '.cue', '.chd'],
        'ngp': ['.ngp'],
        'ngpc': ['.ngc'],
    }
    
    def __init__(self, retrodeck_path: str):
        self.retrodeck_path = Path(retrodeck_path).expanduser()
        if not self.retrodeck_path.exists():
            logger.warning(f"RetroDeck path does not exist: {self.retrodeck_path}")
    
    def _calculate_file_hashes(self, file_path: Path) -> Dict[str, str]:
        """Calculate SHA1, MD5, and CRC32 hashes for a file"""
        sha1 = hashlib.sha1()
        md5 = hashlib.md5()
        crc = 0
        
        try:
            with open(file_path, 'rb') as f:
                while chunk := f.read(8192):
                    sha1.update(chunk)
                    md5.update(chunk)
                    # Simple CRC32 (for compatibility with ROMM's CRC)
                    import zlib
                    crc = zlib.crc32(chunk, crc)
            
            return {
                'sha1': sha1.hexdigest(),
                'md5': md5.hexdigest(),
                'crc': format(crc & 0xFFFFFFFF, '08x')
            }
        except Exception as e:
            logger.error(f"Error hashing file {file_path}: {e}")
            return None
    
    def scan_platform(self, platform: str, progress_callback: Optional[Callable] = None) -> List[Dict]:
        """
        Scan a specific platform directory for ROM files
        
        Args:
            platform: Platform folder name (e.g., 'snes', 'gb')
            progress_callback: Optional callback function(current, total, filename)
        
        Returns:
            List of ROM file information dictionaries
        """
        platform_path = self.retrodeck_path / platform
        
        if not platform_path.exists():
            logger.warning(f"Platform directory does not exist: {platform_path}")
            return []
        
        # Get valid extensions for this platform
        valid_extensions = self.ROM_EXTENSIONS.get(platform.lower(), [])
        if not valid_extensions:
            logger.warning(f"No known extensions for platform: {platform}")
            # Scan all files if we don't know the platform
            valid_extensions = ['.*']
        
        # Find all ROM files
        rom_files = []
        for ext in valid_extensions:
            if ext == '.*':
                # Scan all files
                rom_files.extend(platform_path.rglob('*'))
            else:
                rom_files.extend(platform_path.rglob(f'*{ext}'))
        
        # Filter out directories
        rom_files = [f for f in rom_files if f.is_file()]
        
        logger.info(f"Found {len(rom_files)} potential ROM files in {platform_path}")
        
        results = []
        total = len(rom_files)
        
        for idx, rom_file in enumerate(rom_files, 1):
            if progress_callback:
                progress_callback(idx, total, rom_file.name)
            
            try:
                # Get file info
                stat = rom_file.stat()
                file_size = stat.st_size
                last_modified = datetime.fromtimestamp(stat.st_mtime)
                
                # Calculate hashes
                hashes = self._calculate_file_hashes(rom_file)
                if not hashes:
                    continue
                
                results.append({
                    'platform': platform,
                    'file_name': rom_file.name,
                    'file_path': str(rom_file),
                    'file_size': file_size,
                    'sha1_hash': hashes['sha1'],
                    'md5_hash': hashes['md5'],
                    'crc_hash': hashes['crc'],
                    'last_modified': last_modified
                })
                
                logger.debug(f"Scanned: {rom_file.name} (SHA1: {hashes['sha1'][:8]}...)")
                
            except Exception as e:
                logger.error(f"Error scanning file {rom_file}: {e}")
                continue
        
        logger.info(f"Successfully scanned {len(results)} ROM files for platform {platform}")
        return results
    
    def scan_all_platforms(self, platforms: List[str], progress_callback: Optional[Callable] = None) -> Dict[str, List[Dict]]:
        """
        Scan multiple platform directories
        
        Args:
            platforms: List of platform folder names
            progress_callback: Optional callback function(platform, current, total)
        
        Returns:
            Dictionary mapping platform names to lists of ROM info
        """
        results = {}
        total_platforms = len(platforms)
        
        for idx, platform in enumerate(platforms, 1):
            logger.info(f"Scanning platform {idx}/{total_platforms}: {platform}")
            
            if progress_callback:
                progress_callback(platform, idx, total_platforms)
            
            platform_results = self.scan_platform(platform)
            results[platform] = platform_results
        
        return results
    
    def quick_scan_file(self, file_path: Path) -> Optional[Dict]:
        """Quickly scan a single file and return its hash info"""
        if not file_path.exists() or not file_path.is_file():
            return None
        
        try:
            stat = file_path.stat()
            hashes = self._calculate_file_hashes(file_path)
            
            if hashes:
                return {
                    'file_name': file_path.name,
                    'file_path': str(file_path),
                    'file_size': stat.st_size,
                    'sha1_hash': hashes['sha1'],
                    'md5_hash': hashes['md5'],
                    'crc_hash': hashes['crc'],
                    'last_modified': datetime.fromtimestamp(stat.st_mtime)
                }
        except Exception as e:
            logger.error(f"Error quick scanning {file_path}: {e}")
        
        return None
    
    def get_platform_stats(self, platform: str) -> Dict:
        """Get statistics about a platform directory without hashing"""
        platform_path = self.retrodeck_path / platform
        
        if not platform_path.exists():
            return {'exists': False, 'file_count': 0, 'total_size': 0}
        
        valid_extensions = self.ROM_EXTENSIONS.get(platform.lower(), ['.*'])
        
        rom_files = []
        for ext in valid_extensions:
            if ext == '.*':
                rom_files.extend(platform_path.rglob('*'))
            else:
                rom_files.extend(platform_path.rglob(f'*{ext}'))
        
        rom_files = [f for f in rom_files if f.is_file()]
        total_size = sum(f.stat().st_size for f in rom_files)
        
        return {
            'exists': True,
            'file_count': len(rom_files),
            'total_size': total_size,
            'total_size_mb': round(total_size / (1024 * 1024), 2)
        }
