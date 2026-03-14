from app.core.email import send_email


async def send_verification_code(email: str, code: str) -> None:
    subject = "WikINT - Your verification code"
    body = f"""
    <html>
    <body>
        <h2>WikINT Verification Code</h2>
        <p>Your verification code is:</p>
        <h1 style="font-size: 32px; letter-spacing: 8px; font-family: monospace;">{code}</h1>
        <p>This code expires in 10 minutes.</p>
        <p>If you didn't request this code, you can safely ignore this email.</p>
    </body>
    </html>
    """
    await send_email(email, subject, body)
