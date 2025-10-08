import json
import os
import pg8000
import ssl
from datetime import datetime, date
from typing import Dict, List, Any

def lambda_handler(event, context):
    """
    Send email notification for incomplete/overdue milestones.
    Can be triggered manually or via EventBridge schedule.
    
    Event payload can include:
    - recipient_email: Optional custom recipient email address
    """
    
    print("🚀 Starting milestone email notification...")
    print(f"📥 Event: {event}")
    
    try:
        # Get database config from environment
        db_config = {
            "host": os.environ.get("DB_HOST"),
            "port": int(os.environ.get("DB_PORT", 5432)),
            "database": os.environ.get("DB_NAME"),
            "user": os.environ.get("DB_USER"),
            "password": os.environ.get("DB_PASSWORD")
        }
        
        # Get email config from environment
        sendgrid_api_key = os.environ.get("SENDGRID_API_KEY")
        sender_email = os.environ.get("SENDER_EMAIL")
        
        # Check if custom recipient is provided in event
        custom_recipient = event.get("recipient_email") if isinstance(event, dict) else None
        
        if custom_recipient:
            recipient_emails = [custom_recipient]
            print(f"📧 Using custom recipient: {custom_recipient}")
        else:
            recipient_emails = os.environ.get("RECIPIENT_EMAILS", "").split(",")
            print(f"📧 Using default recipients: {recipient_emails}")
        
        # Validate config
        if not all([db_config["host"], db_config["database"], db_config["user"]]):
            raise ValueError("Missing database configuration")
        
        if not sendgrid_api_key or not sender_email:
            raise ValueError("Missing email configuration (SENDGRID_API_KEY or SENDER_EMAIL)")
        
        if not recipient_emails or not recipient_emails[0]:
            raise ValueError("Missing RECIPIENT_EMAILS")
        
        # Get milestones from database
        milestones = fetch_incomplete_milestones(db_config)
        
        if not milestones:
            print("✅ No incomplete or upcoming milestones found")
            return {
                "statusCode": 200,
                "body": json.dumps({
                    "message": "No milestones to report",
                    "count": 0
                })
            }
        
        # Group milestones by company
        grouped = group_milestones_by_company(milestones)
        
        # Generate email content
        email_html = generate_email_html(grouped, milestones)
        email_text = generate_email_text(grouped, milestones)
        
        # Send email via SendGrid
        result = send_email_sendgrid(
            api_key=sendgrid_api_key,
            from_email=sender_email,
            to_emails=recipient_emails,
            subject=f"🚨 Milestone Reminder - {datetime.now().strftime('%B %Y')}",
            html_content=email_html,
            text_content=email_text
        )
        
        print(f"✅ Email sent successfully to {len(recipient_emails)} recipient(s)")
        print(f"📊 Total milestones: {len(milestones)}")
        
        return {
            "statusCode": 200,
            "body": json.dumps({
                "message": "Email sent successfully",
                "milestone_count": len(milestones),
                "company_count": len(grouped),
                "recipients": len(recipient_emails)
            })
        }
        
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        import traceback
        print(traceback.format_exc())
        
        return {
            "statusCode": 500,
            "body": json.dumps({
                "error": str(e)
            })
        }


def fetch_incomplete_milestones(db_config: Dict) -> List[Dict]:
    """
    Fetch incomplete or upcoming milestones from database.
    Returns milestones that are:
    - Not completed (completed = false)
    - Either overdue OR due in the next 30 days
    """
    conn = None
    try:
        ssl_ctx = ssl.create_default_context()
        conn = pg8000.connect(
            host=db_config["host"],
            port=db_config["port"],
            database=db_config["database"],
            user=db_config["user"],
            password=db_config["password"],
            ssl_context=ssl_ctx,
            timeout=30
        )
        cursor = conn.cursor()
        
        # Query for incomplete milestones (overdue or upcoming in next 30 days)
        query = """
        SELECT 
            m.id,
            m.company_id,
            c.name as company_name,
            m.milestone_date,
            m.description,
            m.priority,
            m.completed,
            m.created_at,
            fr.file_name as report_file_name
        FROM company_milestones m
        JOIN companies c ON m.company_id = c.id
        LEFT JOIN financial_reports fr ON m.financial_report_id = fr.id
        WHERE m.completed = false 
          AND m.milestone_date <= CURRENT_DATE + INTERVAL '30 days'
        ORDER BY m.milestone_date ASC, m.priority DESC
        """
        
        cursor.execute(query)
        rows = cursor.fetchall()
        
        milestones = []
        for row in rows:
            milestone = {
                "id": row[0],
                "company_id": row[1],
                "company_name": row[2],
                "milestone_date": row[3],
                "description": row[4],
                "priority": row[5],
                "completed": row[6],
                "created_at": row[7],
                "report_file_name": row[8]
            }
            milestones.append(milestone)
        
        print(f"📊 Found {len(milestones)} incomplete milestone(s)")
        return milestones
        
    finally:
        if conn:
            conn.close()


def group_milestones_by_company(milestones: List[Dict]) -> Dict[str, List[Dict]]:
    """Group milestones by company name."""
    grouped = {}
    for milestone in milestones:
        company_name = milestone["company_name"]
        if company_name not in grouped:
            grouped[company_name] = []
        grouped[company_name].append(milestone)
    return grouped


def generate_email_html(grouped: Dict[str, List[Dict]], all_milestones: List[Dict]) -> str:
    """Generate HTML email content."""
    
    today = date.today()
    overdue_count = sum(1 for m in all_milestones if m["milestone_date"] < today)
    upcoming_count = len(all_milestones) - overdue_count
    
    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #1a1a1a; background-color: #f9fafb; }}
            .container {{ max-width: 800px; margin: 0 auto; padding: 20px; background-color: white; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }}
            .header {{ background-color: white; padding: 30px 20px; border-bottom: 3px solid #4299e1; text-align: center; }}
            .header h1 {{ margin: 0; font-size: 28px; color: #1a1a1a; }}
            .header p {{ margin: 10px 0 0 0; color: #4a5568; font-size: 16px; }}
            .summary {{ background: #f7fafc; padding: 20px; border-left: 4px solid #4299e1; margin: 20px 0; border-radius: 4px; }}
            .summary h3 {{ color: #1a1a1a; margin-top: 0; }}
            .summary p {{ color: #1a1a1a; font-size: 15px; }}
            .company {{ margin: 20px 0; padding: 20px; background: #fafafa; border-radius: 8px; border: 1px solid #e2e8f0; }}
            .company-name {{ font-size: 20px; font-weight: bold; color: #1a1a1a; margin-bottom: 15px; }}
            .milestone {{ margin: 15px 0; padding: 15px; border-radius: 6px; background: white; }}
            .milestone-description {{ color: #1a1a1a; }}
            .critical {{ border-left: 4px solid #f56565; }}
            .high {{ border-left: 4px solid #ed8936; }}
            .medium {{ border-left: 4px solid #4299e1; }}
            .low {{ border-left: 4px solid #a0aec0; }}
            .overdue {{ color: #e53e3e; font-weight: bold; }}
            .date {{ color: #4a5568; font-size: 14px; }}
            .priority-badge {{ display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: bold; margin-right: 10px; }}
            .badge-critical {{ background: #feb2b2; color: #742a2a; }}
            .badge-high {{ background: #fbd38d; color: #7c2d12; }}
            .badge-medium {{ background: #bee3f8; color: #2c5282; }}
            .badge-low {{ background: #e2e8f0; color: #2d3748; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>📊 Milestone Reminder</h1>
                <p>{datetime.now().strftime('%B %d, %Y')}</p>
            </div>
            
            <div class="summary">
                <h3 style="margin-top: 0;">Summary</h3>
                <p style="margin: 5px 0;">📌 <strong>{len(all_milestones)}</strong> total incomplete milestone(s)</p>
                <p style="margin: 5px 0;">🔴 <strong>{overdue_count}</strong> overdue</p>
                <p style="margin: 5px 0;">📅 <strong>{upcoming_count}</strong> upcoming (next 30 days)</p>
                <p style="margin: 5px 0;">🏢 <strong>{len(grouped)}</strong> compan{"y" if len(grouped) == 1 else "ies"}</p>
            </div>
    """
    
    # Add each company's milestones
    for company_name in sorted(grouped.keys()):
        milestones = grouped[company_name]
        html += f"""
            <div class="company">
                <div class="company-name">🏢 {company_name}</div>
        """
        
        for milestone in milestones:
            priority_class = milestone["priority"].lower()
            badge_class = f"badge-{priority_class}"
            
            # Check if overdue
            is_overdue = milestone["milestone_date"] < today
            overdue_label = '<span class="overdue">(OVERDUE)</span> ' if is_overdue else ''
            
            # Format date
            m_date = milestone["milestone_date"]
            date_str = m_date.strftime('%b %d, %Y')
            
            html += f"""
                <div class="milestone {priority_class}">
                    <div>
                        <span class="priority-badge {badge_class}">{milestone["priority"].upper()}</span>
                        <span class="date">{overdue_label}{date_str}</span>
                    </div>
                    <div class="milestone-description" style="margin-top: 8px; font-size: 15px; color: #2d3748;">
                        {milestone["description"]}
                    </div>
                </div>
            """
        
        html += "</div>"
    
    html += """
        </div>
    </body>
    </html>
    """
    
    return html


def generate_email_text(grouped: Dict[str, List[Dict]], all_milestones: List[Dict]) -> str:
    """Generate plain text email content (fallback)."""
    
    today = date.today()
    overdue_count = sum(1 for m in all_milestones if m["milestone_date"] < today)
    upcoming_count = len(all_milestones) - overdue_count
    
    text = f"""
MILESTONE REMINDER - {datetime.now().strftime('%B %d, %Y')}
{'=' * 60}

SUMMARY:
  • Total incomplete milestones: {len(all_milestones)}
  • Overdue: {overdue_count}
  • Upcoming (next 30 days): {upcoming_count}
  • Companies: {len(grouped)}

{'=' * 60}

"""
    
    for company_name in sorted(grouped.keys()):
        milestones = grouped[company_name]
        text += f"\n🏢 {company_name}\n"
        text += "-" * 60 + "\n"
        
        for milestone in milestones:
            is_overdue = milestone["milestone_date"] < today
            overdue_label = "(OVERDUE) " if is_overdue else ""
            date_str = milestone["milestone_date"].strftime('%b %d, %Y')
            
            priority_icon = {
                "critical": "🚨",
                "high": "🚀",
                "medium": "📋",
                "low": "📝"
            }.get(milestone["priority"].lower(), "📋")
            
            text += f"""
  {priority_icon} {milestone["priority"].upper()} - {overdue_label}{date_str}
     → {milestone["description"]}
"""
        
        text += "\n"
    
    return text


def send_email_sendgrid(api_key: str, from_email: str, to_emails: List[str], 
                        subject: str, html_content: str, text_content: str) -> Dict:
    """
    Send email via SendGrid API.
    Simple HTTP request - no SDK needed.
    """
    import json
    try:
        from urllib import request
    except ImportError:
        import urllib.request as request
    
    # Prepare recipients
    to_list = [{"email": email.strip()} for email in to_emails if email.strip()]
    
    # SendGrid API payload
    payload = {
        "personalizations": [{"to": to_list}],
        "from": {"email": from_email},
        "subject": subject,
        "content": [
            {"type": "text/plain", "value": text_content},
            {"type": "text/html", "value": html_content}
        ]
    }
    
    # Make HTTP request
    req = request.Request(
        "https://api.sendgrid.com/v3/mail/send",
        data=json.dumps(payload).encode('utf-8'),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        },
        method="POST"
    )
    
    response = request.urlopen(req)
    
    if response.status == 202:
        return {"success": True, "status": response.status}
    else:
        raise Exception(f"SendGrid returned status {response.status}")

