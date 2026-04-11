import asyncio
import tempfile
from pathlib import Path
import shutil

async def test():
    tmp_dir = Path(tempfile.mkdtemp(prefix="wikint_office_thumb_"))
    try:
        input_file = Path("/tmp/test_file_(1).pptx")
        input_file.write_text("Hello World!")
        
        cmd = [
            "soffice",
            f"-env:UserInstallation=file://{tmp_dir}",
            "--headless",
            "--norestore",
            "--nofirststartwizard",
            "--convert-to", "pdf",
            "--outdir", str(tmp_dir),
            str(input_file),
        ]
        
        print("Running command:", cmd)
        
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
        print("rc:", process.returncode)
        print("stdout:", stdout.decode(errors="replace"))
        print("stderr:", stderr.decode(errors="replace"))
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

if __name__ == "__main__":
    asyncio.run(test())
