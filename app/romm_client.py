"""
ROMM API Client
Handles all communication with the ROMM server
"""
import requests
from typing import List, Dict, Optional
import logging

logger = logging.getLogger(__name__)


class RommClient:
    def __init__(self, base_url: str, username: str, password: str):
        self.base_url = base_url.rstrip('/')
        self.username = username
        self.password = password
        self.session = requests.Session()
        self.session.auth = (username, password)
        self._test_connection()
    
    def _test_connection(self):
        """Test connection to ROMM server"""
        try:
            response = self.session.get(f"{self.base_url}/api/platforms", timeout=5)
            response.raise_for_status()
            logger.info(f"Successfully connected to ROMM at {self.base_url}")
            return True
        except requests.exceptions.RequestException as e:
            logger.error(f"Failed to connect to ROMM: {e}")
            raise ConnectionError(f"Cannot connect to ROMM server at {self.base_url}: {e}")
    
    def get_platforms(self) -> List[Dict]:
        """Get all platforms from ROMM"""
        try:
            response = self.session.get(f"{self.base_url}/api/platforms")
            response.raise_for_status()
            platforms = response.json()
            logger.info(f"Retrieved {len(platforms)} platforms from ROMM")
            return platforms
        except requests.exceptions.RequestException as e:
            logger.error(f"Error getting platforms: {e}")
            return []
    
    def get_platform_by_id(self, platform_id: int) -> Optional[Dict]:
        """Get a specific platform by ID"""
        try:
            response = self.session.get(f"{self.base_url}/api/platforms/{platform_id}")
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"Error getting platform {platform_id}: {e}")
            return None
    
    def get_roms_by_platform(self, platform_id: int) -> List[Dict]:
        """Get all ROMs for a specific platform (with pagination)"""
        all_roms = []
        limit = 1000
        offset = 0
        
        try:
            while True:
                params = {
                    'platform_ids': platform_id,
                    'limit': limit,
                    'offset': offset
                }
                response = self.session.get(f"{self.base_url}/api/roms", params=params)
                response.raise_for_status()
                data = response.json()
                
                # ROMM returns paginated response with 'items' key
                roms = data.get('items', []) if isinstance(data, dict) else data
                
                if not roms:
                    # No more ROMs to fetch
                    break
                
                all_roms.extend(roms)
                
                # Check if we got fewer than limit (means we're at the end)
                if len(roms) < limit:
                    break
                
                # Move to next page
                offset += limit
                logger.debug(f"Fetching next page: offset={offset}")
            
            logger.info(f"Retrieved {len(all_roms)} ROMs for platform {platform_id}")
            return all_roms
        except requests.exceptions.RequestException as e:
            logger.error(f"Error getting ROMs for platform {platform_id}: {e}")
            return all_roms  # Return what we got so far
    
    def get_rom_by_id(self, rom_id: int) -> Optional[Dict]:
        """Get detailed information about a specific ROM"""
        try:
            response = self.session.get(f"{self.base_url}/api/roms/{rom_id}")
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"Error getting ROM {rom_id}: {e}")
            return None
    
    def download_rom(self, rom_id: int, destination_path: str) -> bool:
        """Download a ROM file to the specified path"""
        try:
            # Get ROM details to find the file
            rom = self.get_rom_by_id(rom_id)
            if not rom or 'files' not in rom or len(rom['files']) == 0:
                logger.error(f"ROM {rom_id} has no files")
                return False
            
            # For multi-file ROMs, we'll need to handle this differently
            # For now, download the first file
            file_info = rom['files'][0]
            file_id = file_info['id']
            
            # Download endpoint - this might vary, check your ROMM API docs
            download_url = f"{self.base_url}/api/roms/{rom_id}/content/{file_id}"
            
            logger.info(f"Downloading ROM {rom_id} to {destination_path}")
            
            response = self.session.get(download_url, stream=True)
            response.raise_for_status()
            
            # Write file in chunks
            with open(destination_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            logger.info(f"Successfully downloaded ROM to {destination_path}")
            return True
            
        except requests.exceptions.RequestException as e:
            logger.error(f"Error downloading ROM {rom_id}: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error downloading ROM {rom_id}: {e}")
            return False
    
    def get_rom_cover_url(self, rom_id: int) -> Optional[str]:
        """Get the cover art URL for a ROM"""
        rom = self.get_rom_by_id(rom_id)
        if rom and 'cover' in rom and rom['cover']:
            # ROMM typically serves covers at /assets/romm/resources/...
            cover_path = rom['cover'].get('path_cover_l') or rom['cover'].get('path_cover_s')
            if cover_path:
                return f"{self.base_url}{cover_path}"
        return None
    
    def search_roms(self, query: str, platform_id: Optional[int] = None) -> List[Dict]:
        """Search for ROMs by name"""
        try:
            params = {'search_term': query}
            if platform_id:
                params['platform_id'] = platform_id
            
            response = self.session.get(f"{self.base_url}/api/roms", params=params)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"Error searching ROMs: {e}")
            return []
