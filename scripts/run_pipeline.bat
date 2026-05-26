@echo off
REM asset-librarian: run full scan pipeline
REM Usage: run_pipeline.bat [--root <dir>]

python scripts\init_db.py %*
python scripts\scan_assets.py %*
python scripts\create_thumbnails.py %*
echo.
echo ✅ Pipeline complete.
