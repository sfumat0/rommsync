"""
RommSync - Main Application
A tool to sync ROMs from ROMM server to RetroDeck
"""
import sys
import yaml
import logging
from pathlib import Path
from typing import Optional, List, Dict
import webbrowser
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
import uvicorn

from database import Database
from romm_client import RommClient
from hash_scanner import RomScanner

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Global state
config = None
db = None
romm_client = None
scanner = None
scan_in_progress = False


def load_config():
    """Load configuration from config.yaml"""
    config_path = Path("config.yaml")
    if not config_path.exists():
        config_path = Path("config.example.yaml")
        if not config_path.exists():
            raise FileNotFoundError("No config.yaml found. Copy config.example.yaml to config.yaml")
    
    with open(config_path, 'r') as f:
        cfg = yaml.safe_load(f)
    
    # Set database path based on whether we're frozen (AppImage)
    if getattr(sys, 'frozen', False):
        data_dir = Path.home() / '.rommsync'
        data_dir.mkdir(exist_ok=True)
        cfg['paths']['database'] = str(data_dir / 'romm_sync.db')
    elif 'database' not in cfg.get('paths', {}):
        Path('data').mkdir(exist_ok=True)
        cfg['paths']['database'] = 'data/romm_sync.db'
    
    return cfg


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events"""
    global config, db, romm_client, scanner
    
    # Startup
    logger.info("Starting RommSync...")
    config = load_config()
    
    # Initialize database
    db = Database(config['paths']['database'])
    
    # Initialize ROMM client
    try:
        romm_client = RommClient(
            config['romm']['url'],
            config['romm']['username'],
            config['romm']['password']
        )
    except ConnectionError as e:
        logger.error(f"Failed to connect to ROMM: {e}")
        logger.error("Please check your config.yaml settings")
    
    # Initialize scanner
    scanner = RomScanner(config['paths']['retrodeck_roms'])
    
    logger.info("RommSync started successfully!")
    
    yield
    
    # Shutdown
    logger.info("Shutting down RommSync...")
    if db:
        db.close()


# Create FastAPI app
app = FastAPI(
    title="RommSync",
    description="Sync ROMs from ROMM to RetroDeck",
    version="1.0.0",
    lifespan=lifespan
)

# Mount static files
# Mount static files - handle PyInstaller bundle
if getattr(sys, 'frozen', False):
    static_path = Path(sys._MEIPASS) / 'static'
else:
    static_path = Path(__file__).parent / 'static'
app.mount("/static", StaticFiles(directory=str(static_path)), name="static")


# Pydantic models
class ScanRequest(BaseModel):
    platforms: List[str]


class DownloadRequest(BaseModel):
    rom_id: int
    platform: str


# API Endpoints

@app.get("/")
async def root():
    """Serve the main UI"""
    return FileResponse("app/static/index.html")


@app.get("/api/config")
async def get_config():
    """Get current configuration (sanitized)"""
    return {
        'romm_url': config['romm']['url'],
        'romm_username': config['romm']['username'],
        'retrodeck_path': config['paths']['retrodeck_roms'],
        'platform_mapping': config.get('platform_mapping', {})
    }

@app.post("/api/config")
async def save_config(request: Request):
    """Save configuration to config.yaml"""
    try:
        data = await request.json()
        
        # Update config
        config['romm']['url'] = data.get('romm_url', config['romm']['url'])
        config['romm']['username'] = data.get('romm_username', config['romm']['username'])
        
        if data.get('romm_password'):
            config['romm']['password'] = data['romm_password']
        
        config['paths']['retrodeck_roms'] = data.get('retrodeck_path', config['paths']['retrodeck_roms'])
        config['platform_mapping'] = data.get('platform_mapping', config.get('platform_mapping', {}))
        
        # Save to file
        with open('config.yaml', 'w') as f:
            yaml.dump(config, f, default_flow_style=False)
        
        # Reinitialize ROMM client with new credentials
        global romm_client
        romm_client = RommClient(
            config['romm']['url'],
            config['romm']['username'],
            config['romm']['password']
        )
        
        return {"status": "success", "message": "Configuration saved"}
    except Exception as e:
        logger.error(f"Error saving config: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/platforms")
async def get_platforms():
    """Get all platforms from ROMM"""
    if not romm_client:
        raise HTTPException(status_code=503, detail="ROMM client not initialized")
    
    try:
        platforms = romm_client.get_platforms()
        
        # Get local ROM counts from database
        local_stats = db.get_scan_stats()
        local_by_platform = {p['platform']: p['count'] for p in local_stats.get('by_platform', [])}
        
        # Enhance with local stats
        for platform in platforms:
            platform_name = platform.get('name', '')
            # Try to find matching RetroDeck folder
            retrodeck_folder = config.get('platform_mapping', {}).get(platform_name)
            
            if retrodeck_folder:
                # Get count from database
                local_count = local_by_platform.get(retrodeck_folder, 0)
                platform['local_stats'] = {
                    'exists': True,
                    'file_count': local_count
                }
            else:
                platform['local_stats'] = {'exists': False, 'file_count': 0}
        
        return platforms
    except Exception as e:
        logger.error(f"Error getting platforms: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/platforms/{platform_id}/roms")
async def get_platform_roms(platform_id: int):
    """Get all ROMs for a platform with local availability status"""
    if not romm_client:
        raise HTTPException(status_code=503, detail="ROMM client not initialized")
    
    try:
        # Get ROMs from ROMM
        roms = romm_client.get_roms_by_platform(platform_id)
        
        # Get platform info to find the local folder
        platform_info = romm_client.get_platform_by_id(platform_id)
        platform_name = platform_info.get('name') if platform_info else None
        retrodeck_folder = config.get('platform_mapping', {}).get(platform_name) if platform_name else None
        
        # Get all local ROMs for this platform once (for filename fallback)
        local_roms_by_filename = {}
        if retrodeck_folder:
            local_roms = db.get_local_roms_by_platform(retrodeck_folder)
            local_roms_by_filename = {rom['file_name']: rom for rom in local_roms}
        
        # Create new list with local availability info
        enhanced_roms = []
        for idx, rom in enumerate(roms):
            try:
                # Check if rom is a dict
                if not isinstance(rom, dict):
                    logger.error(f"ROM {idx} is not a dict, it's {type(rom)}")
                    continue
                
                # Extract just the data we need
                rom_data = {
                    'id': rom.get('id'),
                    'name': rom.get('name'),
                    'file_name': rom.get('file_name'),
                    'files': rom.get('files', []),
                    'summary': rom.get('summary'),
                    'url_cover': rom.get('url_cover'),
                }
                
                local_rom = None
                
                if 'files' in rom and len(rom['files']) > 0:
                    file_info = rom['files'][0]
                    sha1 = file_info.get('sha1_hash')
                    file_name = file_info.get('file_name')
                    
                    # Try hash match first
                    if sha1:
                        local_rom = db.get_local_rom_by_hash(sha1)
                    
                    # Fallback to filename match
                    if not local_rom and file_name and file_name in local_roms_by_filename:
                        local_rom = local_roms_by_filename[file_name]
                    
                    rom_data['local_available'] = local_rom is not None
                    if local_rom:
                        rom_data['local_path'] = local_rom['file_path']
                else:
                    rom_data['local_available'] = False
                
                enhanced_roms.append(rom_data)
            except Exception as rom_error:
                logger.error(f"Error processing ROM index {idx}: {rom_error}", exc_info=True)
                continue
        
        logger.info(f"Returning {len(enhanced_roms)} ROMs for platform {platform_id}")
        return JSONResponse(content=enhanced_roms)
    except Exception as e:
        logger.error(f"Error getting ROMs for platform {platform_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/roms/{rom_id}")
async def get_rom_details(rom_id: int):
    """Get detailed information about a specific ROM"""
    if not romm_client:
        raise HTTPException(status_code=503, detail="ROMM client not initialized")
    
    try:
        rom = romm_client.get_rom_by_id(rom_id)
        if not rom:
            raise HTTPException(status_code=404, detail="ROM not found")
        
        # Check local availability
        if 'files' in rom and len(rom['files']) > 0:
            file_info = rom['files'][0]
            sha1 = file_info.get('sha1_hash')
            file_name = file_info.get('file_name')
            
            logger.info(f"Checking ROM {rom_id} - SHA1: {sha1}, Filename: {file_name}")
            
            local_rom = None
            
            # Try hash matching first (most reliable)
            if sha1:
                local_rom = db.get_local_rom_by_hash(sha1)
                if local_rom:
                    logger.info(f"ROM {rom_id} matched by SHA1 hash")
            
            # Fallback to filename matching if no hash or no match
            if not local_rom and file_name:
                logger.info(f"No hash match, trying filename match for: {file_name}")
                # Get platform folder to search in
                platform_name = rom.get('platform_display_name') or rom.get('platform_slug')
                if platform_name:
                    retrodeck_folder = config.get('platform_mapping', {}).get(platform_name)
                    if retrodeck_folder:
                        # Query by platform and filename
                        all_local = db.get_local_roms_by_platform(retrodeck_folder)
                        for local in all_local:
                            if local['file_name'] == file_name:
                                local_rom = local
                                logger.info(f"ROM {rom_id} matched by filename")
                                break
            
            rom['local_available'] = local_rom is not None
            if local_rom:
                rom['local_path'] = local_rom['file_path']
            else:
                logger.info(f"ROM {rom_id} not found locally (tried hash and filename)")
        
        return rom
    except Exception as e:
        logger.error(f"Error getting ROM {rom_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/scan")
async def scan_local_roms(request: ScanRequest, background_tasks: BackgroundTasks):
    """Scan local ROM directories for the specified platforms"""
    global scan_in_progress
    
    if scan_in_progress:
        raise HTTPException(status_code=409, detail="Scan already in progress")
    
    def do_scan(platforms: List[str]):
        global scan_in_progress
        scan_in_progress = True
        
        try:
            import time
            start_time = time.time()
            
            logger.info(f"Starting scan of {len(platforms)} platforms")
            
            for platform in platforms:
                # Clear existing entries for this platform
                db.clear_platform(platform)
                
                # Scan the directory
                results = scanner.scan_platform(platform)
                
                # Store in database
                for rom_info in results:
                    db.add_local_rom(**rom_info)
                
                # Record scan
                duration = time.time() - start_time
                db.add_scan_record(platform, len(results), duration)
                
                logger.info(f"Scanned {platform}: {len(results)} files")
            
            duration = time.time() - start_time
            logger.info(f"Scan completed in {duration:.2f} seconds")
            
        except Exception as e:
            logger.error(f"Error during scan: {e}")
        finally:
            scan_in_progress = False
    
    background_tasks.add_task(do_scan, request.platforms)
    
    return {"status": "Scan started", "platforms": request.platforms}


@app.get("/api/scan/status")
async def get_scan_status():
    """Get current scan status"""
    stats = db.get_scan_stats()
    return {
        "in_progress": scan_in_progress,
        "stats": stats
    }


@app.post("/api/download")
async def download_rom(request: DownloadRequest, background_tasks: BackgroundTasks):
    """Download a ROM from ROMM to RetroDeck"""
    if not romm_client:
        raise HTTPException(status_code=503, detail="ROMM client not initialized")
    
    # Get ROM details
    rom = romm_client.get_rom_by_id(request.rom_id)
    if not rom or 'files' not in rom or len(rom['files']) == 0:
        raise HTTPException(status_code=404, detail="ROM not found or has no files")
    
    file_info = rom['files'][0]
    file_name = file_info['file_name']
    
    # Determine destination path
    retrodeck_path = Path(config['paths']['retrodeck_roms']).expanduser()
    platform_path = retrodeck_path / request.platform
    platform_path.mkdir(parents=True, exist_ok=True)
    
    destination = platform_path / file_name
    
    def do_download(rom_id: int, dest: Path, file_info: Dict, platform: str):
        try:
            logger.info(f"Downloading ROM {rom_id} to {dest}")
            success = romm_client.download_rom(rom_id, str(dest))
            
            if success:
                # Add to local database
                rom_info = scanner.quick_scan_file(dest)
                if rom_info:
                    rom_info['platform'] = platform
                    db.add_local_rom(**rom_info)
                    logger.info(f"Successfully downloaded and registered {file_name}")
            else:
                logger.error(f"Failed to download ROM {rom_id}")
                
        except Exception as e:
            logger.error(f"Error downloading ROM: {e}")
    
    background_tasks.add_task(do_download, request.rom_id, destination, file_info, request.platform)
    
    return {
        "status": "Download started",
        "rom_id": request.rom_id,
        "destination": str(destination)
    }


@app.post("/generate_mappings")
async def generate_platform_mappings():
    """Generate platform mappings from ROMM API"""
    if not romm_client:
        raise HTTPException(status_code=503, detail="ROMM client not initialized")
    
    try:
        platforms = romm_client.get_platforms()
        
        # Known mappings (same as generate_platform_mapping.py)
        known_mappings = {
            "Nintendo - Game Boy": "gb", "Nintendo - Game Boy Color": "gbc",
            "Nintendo - Game Boy Advance": "gba", "Nintendo - Nintendo Entertainment System": "nes",
            "Nintendo - Super Nintendo Entertainment System": "snes", "Nintendo - Nintendo 64": "n64",
            "Nintendo - GameCube": "gc", "Nintendo - Wii": "wii", "Nintendo - Wii U": "wiiu",
            "Nintendo - Nintendo DS": "nds", "Nintendo - Nintendo 3DS": "3ds", "Nintendo Switch": "switch",
            "Sony - PlayStation": "psx", "Sony - PlayStation 2": "ps2", "Sony - PlayStation 3": "ps3",
            "Sony - PlayStation Portable": "psp", "Sony - PlayStation Vita": "psvita",
            "Sega - Master System": "mastersystem", "Sega - Mega Drive": "genesis",
            "Sega - Game Gear": "gamegear", "Sega - Saturn": "saturn", "Sega - Dreamcast": "dreamcast",
            "Atari 2600": "atari2600", "Atari 5200": "atari5200", "Atari 7800": "atari7800"
        }
        
        mappings = {}
        for platform in platforms:
            name = platform.get('name', '')
            if name in known_mappings:
                mappings[name] = known_mappings[name]
            else:
                slug = platform.get('slug', name.lower().replace(' ', '').replace('-', ''))
                mappings[name] = slug
        
        return mappings
    except Exception as e:
        logger.error(f"Error generating mappings: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/stats")
async def get_stats():
    """Get overall statistics"""
    local_stats = db.get_scan_stats()
    
    # Get ROMM stats
    romm_stats = {}
    if romm_client:
        try:
            platforms = romm_client.get_platforms()
            romm_stats = {
                'total_platforms': len(platforms),
                'platforms': platforms
            }
        except:
            pass
    
    return {
        'local': local_stats,
        'romm': romm_stats
    }


def main():
    """Main entry point"""
    # Load config to get port
    try:
        cfg = load_config()
    except FileNotFoundError as e:
        print(f"Error: {e}")
        print("Please copy config.example.yaml to config.yaml and update with your settings")
        return
    
    host = cfg['app'].get('host', '127.0.0.1')
    port = cfg['app'].get('port', 5000)
    auto_open = cfg['app'].get('auto_open_browser', True)
    
    # Open browser
    if auto_open:
        import threading
        def open_browser():
            import time
            time.sleep(1.5)
            webbrowser.open(f'http://{host}:{port}')
        threading.Thread(target=open_browser, daemon=True).start()
    
    # Run server
    uvicorn.run(
        app,
        host=host,
        port=port,
        log_level="info"
    )


if __name__ == "__main__":
    main()
