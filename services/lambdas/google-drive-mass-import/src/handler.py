import json
import os
import ssl
import base64
import tempfile
from typing import Dict, Any, List
import traceback

import pg8000
from googleapiclient.discovery import build
from google.oauth2 import service_account
import requests

def _unwrap_lambda_http(result: Dict[str, Any]) -> Dict[str, Any]:
    """If a Lambda returned an API Gateway-style dict, pull out and json-load the body."""
    if isinstance(result, dict) and "statusCode" in result and "body" in result:
        try:
            return json.loads(result["body"])
        except Exception:
            return result
    return result

def _gzip_b64(data: bytes) -> str:
    import gzip, io, base64
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb") as f:
        f.write(data)
    return base64.b64encode(buf.getvalue()).decode()

def lambda_handler(event, context):
    """
    AWS Lambda function for mass import from Google Drive
    Processes cap tables (XLSX) and board decks (PDF) organized by company folders
    """
    
    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }

    if event.get("httpMethod") == "OPTIONS" or \
       event.get("requestContext", {}).get("http", {}).get("method") == "OPTIONS":
        return {"statusCode": 200, "headers": headers,
                "body": json.dumps({"message": "CORS preflight handled"})}

    try:
        body = json.loads(event.get("body", "{}"))
    except json.JSONDecodeError:
        return {"statusCode": 400, "headers": headers,
                "body": json.dumps({"error": "Invalid JSON in request body"})}

    operation = event.get("operation") or body.get("operation")
    if operation != "mass_import_from_drive":
        return {"statusCode": 400, "headers": headers,
                "body": json.dumps({"error": "Invalid operation. Expected 'mass_import_from_drive'"})}

    # Required parameters
    root_folder_id = body.get("root_folder_id")
    service_account_key = body.get("service_account_key")  # Base64 encoded service account JSON
    
    if not root_folder_id or not service_account_key:
        return {"statusCode": 400, "headers": headers,
                "body": json.dumps({"error": "Missing required fields: root_folder_id, service_account_key"})}

    # Optional parameters
    company_filter = body.get("company_filter")  # List of company names to process (if None, process all)
    dry_run = body.get("dry_run", False)  # If True, just analyze without processing

    try:
        result = process_google_drive_mass_import(
            root_folder_id=root_folder_id,
            service_account_key=service_account_key,
            company_filter=company_filter,
            dry_run=dry_run
        )
        
        status_code = 200 if result["success"] else 500
        return {"statusCode": status_code, "headers": headers, "body": json.dumps(result)}
        
    except Exception as e:
        print(f"Mass import failed: {str(e)}")
        print(traceback.format_exc())
        return {"statusCode": 500, "headers": headers,
                "body": json.dumps({"error": f"Mass import failed: {str(e)}"})}


def process_google_drive_mass_import(root_folder_id: str, service_account_key: str, 
                                   company_filter: List[str] = None, dry_run: bool = False) -> Dict[str, Any]:
    """
    Main processing function for Google Drive mass import
    """
    
    try:
        # Initialize Google Drive service
        drive_service = initialize_drive_service(service_account_key)
        
        # Get all company folders
        company_folders = get_company_folders(drive_service, root_folder_id)
        
        if not company_folders:
            return {
                "success": False,
                "error": "No company folders found in the specified root folder"
            }
        
        # Filter companies if specified
        if company_filter:
            company_folders = [f for f in company_folders if f['name'] in company_filter]
        
        print(f"Found {len(company_folders)} company folders to process")
        
        # Process each company folder
        results = {
            "success": True,
            "processed_companies": [],
            "failed_companies": [],
            "summary": {
                "total_companies": len(company_folders),
                "successful_companies": 0,
                "failed_companies": 0,
                "total_cap_tables": 0,
                "total_board_decks": 0,
                "successful_cap_tables": 0,
                "successful_board_decks": 0,
                "failed_cap_tables": 0,
                "failed_board_decks": 0
            }
        }
        
        for company_folder in company_folders:
            company_name = company_folder['name']
            folder_id = company_folder['id']
            
            print(f"Processing company: {company_name}")
            
            try:
                company_result = process_company_folder(
                    drive_service=drive_service,
                    company_name=company_name,
                    folder_id=folder_id,
                    dry_run=dry_run
                )
                
                if company_result["success"]:
                    results["processed_companies"].append(company_result)
                    results["summary"]["successful_companies"] += 1
                else:
                    results["failed_companies"].append({
                        "company_name": company_name,
                        "error": company_result.get("error", "Unknown error")
                    })
                    results["summary"]["failed_companies"] += 1
                
                # Update summary counters
                summary = company_result.get("summary", {})
                results["summary"]["total_cap_tables"] += summary.get("cap_tables_found", 0)
                results["summary"]["total_board_decks"] += summary.get("board_decks_found", 0)
                results["summary"]["successful_cap_tables"] += summary.get("cap_tables_processed", 0)
                results["summary"]["successful_board_decks"] += summary.get("board_decks_processed", 0)
                results["summary"]["failed_cap_tables"] += summary.get("cap_tables_failed", 0)
                results["summary"]["failed_board_decks"] += summary.get("board_decks_failed", 0)
                
            except Exception as e:
                print(f"Error processing company {company_name}: {str(e)}")
                results["failed_companies"].append({
                    "company_name": company_name,
                    "error": str(e)
                })
                results["summary"]["failed_companies"] += 1
        
        return results
        
    except Exception as e:
        return {
            "success": False,
            "error": f"Drive mass import failed: {str(e)}"
        }


def initialize_drive_service(service_account_key: str):
    """
    Initialize Google Drive API service using service account credentials
    """
    
    try:
        # Decode the base64 service account key
        service_account_info = json.loads(base64.b64decode(service_account_key))
        
        # Create credentials
        credentials = service_account.Credentials.from_service_account_info(
            service_account_info,
            scopes=['https://www.googleapis.com/auth/drive.readonly']
        )
        
        # Build the Drive API service
        service = build('drive', 'v3', credentials=credentials)
        
        # Test the connection
        service.about().get(fields="user").execute()
        
        return service
        
    except Exception as e:
        raise Exception(f"Failed to initialize Google Drive service: {str(e)}")


def get_company_folders(drive_service, root_folder_id: str) -> List[Dict[str, str]]:
    """
    Get all folders (companies) within the root folder
    """
    
    try:
        query = f"'{root_folder_id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"
        
        results = drive_service.files().list(
            q=query,
            fields="files(id, name)",
            pageSize=1000
        ).execute()
        
        folders = results.get('files', [])
        
        print(f"Found {len(folders)} company folders")
        for folder in folders:
            print(f"  - {folder['name']} ({folder['id']})")
        
        return folders
        
    except Exception as e:
        raise Exception(f"Failed to get company folders: {str(e)}")


def process_company_folder(drive_service, company_name: str, folder_id: str, dry_run: bool = False) -> Dict[str, Any]:
    """
    Process all files in a company folder (cap tables and board decks)
    """
    
    try:
        # Get all files in the company folder
        query = f"'{folder_id}' in parents and trashed=false"
        
        results = drive_service.files().list(
            q=query,
            fields="files(id, name, mimeType, size)",
            pageSize=1000
        ).execute()
        
        files = results.get('files', [])
        
        # Separate files by type
        cap_tables = [f for f in files if f['name'].lower().endswith('.xlsx')]
        board_decks = [f for f in files if f['name'].lower().endswith('.pdf')]
        
        print(f"Company {company_name}: {len(cap_tables)} cap tables, {len(board_decks)} board decks")
        
        result = {
            "success": True,
            "company_name": company_name,
            "folder_id": folder_id,
            "summary": {
                "cap_tables_found": len(cap_tables),
                "board_decks_found": len(board_decks),
                "cap_tables_processed": 0,
                "board_decks_processed": 0,
                "cap_tables_failed": 0,
                "board_decks_failed": 0
            },
            "processed_files": [],
            "failed_files": []
        }
        
        if dry_run:
            result["dry_run"] = True
            result["would_process"] = {
                "cap_tables": [f['name'] for f in cap_tables],
                "board_decks": [f['name'] for f in board_decks]
            }
            return result
        
        # Process cap tables
        for cap_table in cap_tables:
            try:
                file_result = process_cap_table_file(
                    drive_service=drive_service,
                    file_info=cap_table,
                    company_name=company_name
                )
                
                if file_result["success"]:
                    result["processed_files"].append(file_result)
                    result["summary"]["cap_tables_processed"] += 1
                else:
                    result["failed_files"].append(file_result)
                    result["summary"]["cap_tables_failed"] += 1
                    
            except Exception as e:
                print(f"Error processing cap table {cap_table['name']}: {str(e)}")
                result["failed_files"].append({
                    "file_name": cap_table['name'],
                    "file_type": "cap_table",
                    "error": str(e)
                })
                result["summary"]["cap_tables_failed"] += 1
        
        # Process board decks
        for board_deck in board_decks:
            try:
                file_result = process_board_deck_file(
                    drive_service=drive_service,
                    file_info=board_deck,
                    company_name=company_name
                )
                
                if file_result["success"]:
                    result["processed_files"].append(file_result)
                    result["summary"]["board_decks_processed"] += 1
                else:
                    result["failed_files"].append(file_result)
                    result["summary"]["board_decks_failed"] += 1
                    
            except Exception as e:
                print(f"Error processing board deck {board_deck['name']}: {str(e)}")
                result["failed_files"].append({
                    "file_name": board_deck['name'],
                    "file_type": "board_deck",
                    "error": str(e)
                })
                result["summary"]["board_decks_failed"] += 1
        
        return result
        
    except Exception as e:
        return {
            "success": False,
            "company_name": company_name,
            "error": f"Failed to process company folder: {str(e)}"
        }


def process_cap_table_file(drive_service, file_info: Dict[str, Any], company_name: str) -> Dict[str, Any]:
    """
    Download and process a cap table XLSX file
    """
    
    try:
        print(f"Processing cap table: {file_info['name']}")
        
        # Download file
        file_content = download_file(drive_service, file_info['id'])
        if not file_content:
            return {
                "success": False,
                "file_name": file_info['name'],
                "file_type": "cap_table",
                "error": "Failed to download file"
            }
        
        # Convert to base64 for processing
        file_base64 = base64.b64encode(file_content).decode('utf-8')
        
        # Call the existing cap table processor with company name override
        processor_result = call_cap_table_processor(
            xlsx_data=file_base64,
            filename=file_info['name'],
            company_name_override=company_name
        )
        
        return {
            "success": processor_result.get("success", False),
            "file_name": file_info['name'],
            "file_type": "cap_table",
            "file_id": file_info['id'],
            "processor_result": processor_result
        }
        
    except Exception as e:
        return {
            "success": False,
            "file_name": file_info['name'],
            "file_type": "cap_table",
            "error": str(e)
        }


def process_board_deck_file(drive_service, file_info: Dict[str, Any], company_name: str) -> Dict[str, Any]:
    """
    Download and process a board deck PDF file
    """
    
    try:
        print(f"Processing board deck: {file_info['name']}")
        
        # Download file
        file_content = download_file(drive_service, file_info['id'])
        if not file_content:
            return {
                "success": False,
                "file_name": file_info['name'],
                "file_type": "board_deck",
                "error": "Failed to download file"
            }
        
        # Handle large PDFs with gzip compression to stay under 6MB invoke limit
        raw_len = len(file_content)
        if raw_len > 5_500_000:  # ~5.5 MB buffer to avoid 6 MB limit
            pdf_b64 = _gzip_b64(file_content)
            analyzer_result = call_pdf_analyzer(pdf_b64, file_info['name'], company_name, compressed=True)
        else:
            pdf_b64 = base64.b64encode(file_content).decode('utf-8')
            analyzer_result = call_pdf_analyzer(pdf_b64, file_info['name'], company_name, compressed=False)
        
        # Save the financial report with company name override
        if analyzer_result.get("success"):
            save_result = call_financial_crud_save(
                analyzer_result["data"],
                company_name_override=company_name
            )
            
            return {
                "success": save_result.get("success", False),
                "file_name": file_info['name'],
                "file_type": "board_deck",
                "file_id": file_info['id'],
                "analyzer_result": analyzer_result,
                "save_result": save_result
            }
        else:
            return {
                "success": False,
                "file_name": file_info['name'],
                "file_type": "board_deck",
                "analyzer_result": analyzer_result
            }
        
    except Exception as e:
        return {
            "success": False,
            "file_name": file_info['name'],
            "file_type": "board_deck",
            "error": str(e)
        }


def download_file(drive_service, file_id: str) -> bytes:
    """
    Download a file from Google Drive
    """
    
    try:
        request = drive_service.files().get_media(fileId=file_id)
        file_content = request.execute()
        return file_content
        
    except Exception as e:
        print(f"Error downloading file {file_id}: {str(e)}")
        return None


def call_cap_table_processor(xlsx_data: str, filename: str, company_name_override: str) -> Dict[str, Any]:
    """
    Call the existing cap table processor Lambda function with company name override
    """
    
    try:
        import boto3
        lambda_client = boto3.client('lambda', region_name='us-east-1')
        
        payload = {
            "operation": "process_cap_table",
            "xlsx_b64": xlsx_data,
            "filename": filename,
            "company_name_override": company_name_override
        }
        
        response = lambda_client.invoke(
            FunctionName='kv-automation-process-cap-table',
            InvocationType='RequestResponse',
            Payload=json.dumps(payload)
        )
        
        raw = json.loads(response['Payload'].read())
        return _unwrap_lambda_http(raw)
        
    except Exception as e:
        return {
            "success": False,
            "error": f"Cap table processor failed: {str(e)}"
        }


def call_pdf_analyzer(pdf_data_b64: str, filename: str, company_name_override: str, compressed: bool = False) -> Dict[str, Any]:
    """
    Call the existing PDF analyzer Lambda function with company name override
    """
    
    try:
        import boto3
        lambda_client = boto3.client('lambda', region_name='us-east-1')
        
        payload = {
            "operation": "analyze_pdf",
            "pdf_b64": pdf_data_b64,
            "compressed": compressed,
            "filename": filename,
            "company_name_override": company_name_override
        }
        
        resp = lambda_client.invoke(
            FunctionName='kv-automation-pdf-analysis',
            InvocationType='RequestResponse',
            Payload=json.dumps(payload)
        )
        
        raw = json.loads(resp['Payload'].read())
        return _unwrap_lambda_http(raw)
        
    except Exception as e:
        return {
            "success": False,
            "error": f"PDF analyzer failed: {str(e)}"
        }


def call_financial_crud_save(financial_data: Dict[str, Any], company_name_override: str) -> Dict[str, Any]:
    """
    Call the existing financial CRUD save function with company name override
    """
    
    try:
        import boto3
        lambda_client = boto3.client('lambda', region_name='us-east-1')
        
        # Override the company name in the financial data
        financial_data_copy = financial_data.copy()
        financial_data_copy['companyName'] = company_name_override
        
        payload = {
            "operation": "save_financial_report",
            "data": financial_data_copy
        }
        
        response = lambda_client.invoke(
            FunctionName='kv-automation-financial-crud',
            InvocationType='RequestResponse',
            Payload=json.dumps(payload)
        )
        
        result = json.loads(response['Payload'].read())
        return result
        
    except Exception as e:
        return {
            "success": False,
            "error": f"Financial CRUD save failed: {str(e)}"
        } 