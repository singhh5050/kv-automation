import json
import os
import ssl
import requests
from typing import Dict, Any, Optional
from datetime import datetime

import pg8000

def lambda_handler(event, context):
    """
    Lambda function for Harmonic AI company enrichment
    Expects: POST request with company identifier (website_url, etc.)
    Returns: Enriched company data
    """
    
    # Log the incoming event for debugging
    print(f"Harmonic Enrichment Lambda invoked with event: {json.dumps(event)[:500]}...")
    
    # CORS headers for all responses
    cors_headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    }
    
    # Handle CORS preflight requests
    http_method = event.get('httpMethod') or event.get('requestContext', {}).get('http', {}).get('method')
    if http_method == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': json.dumps({'message': 'CORS preflight OK'})
        }
    
    # Parse the request
    try:
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
        else:
            body = event.get('body', {})
            
        # Handle direct Lambda invoke (no HTTP wrapper)
        if not body and any(key in event for key in ['website_url', 'company_id']):
            body = event
            
        print(f"Parsed request body: {json.dumps(body)}")
        
    except json.JSONDecodeError as e:
        print(f"JSON decode error: {e}")
        return {
            'statusCode': 400,
            'headers': cors_headers,
            'body': json.dumps({'error': 'Invalid JSON in request body'})
        }
    
    # Check for operation type
    operation = body.get('operation', 'enrich_company')
    
    if operation == 'enrich_person':
        return handle_person_enrichment(body, cors_headers)
    
    if operation == 'get_company_enrichment':
        return handle_get_company_enrichment(body, cors_headers)
    
    # Validate required fields for company enrichment
    company_id = body.get('company_id')
    if not company_id:
        return {
            'statusCode': 400,
            'headers': cors_headers,
            'body': json.dumps({'error': 'company_id is required'})
        }
    
    # Get the identifier for Harmonic API
    identifier_key = None
    identifier_value = None
    
    # Priority order for identifiers
    identifier_fields = [
        'website_url', 'website_domain', 'linkedin_url', 'crunchbase_url',
        'pitchbook_url', 'twitter_url', 'instagram_url', 'facebook_url',
        'angellist_url', 'monster_url', 'indeed_url', 'stackoverflow_url'
    ]
    
    for field in identifier_fields:
        if body.get(field):
            identifier_key = field
            identifier_value = body[field]
            break
    
    if not identifier_key or not identifier_value:
        return {
            'statusCode': 400,
            'headers': cors_headers,
            'body': json.dumps({'error': 'At least one company identifier is required (website_url, linkedin_url, etc.)'})
        }
    
    try:
        # Call Harmonic AI API for enrichment
        enrichment_result = enrich_company_with_harmonic(identifier_key, identifier_value)
        
        if enrichment_result.get('error'):
            return {
                'statusCode': 400,
                'headers': cors_headers,
                'body': json.dumps({'error': enrichment_result['error']})
            }
        
        # Save enriched data to database
        save_result = save_enrichment_to_database(company_id, enrichment_result)
        
        if save_result.get('error'):
            # Still return the enrichment data even if save fails
            print(f"Warning: Failed to save enrichment to database: {save_result['error']}")
        
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': json.dumps({
                'success': True,
                'data': {
                    'enrichment': enrichment_result,
                    'saved_to_db': not bool(save_result.get('error')),
                    'company_id': company_id
                }
            })
        }
        
    except Exception as e:
        print(f"Unexpected error in enrichment: {e}")
        import traceback
        traceback.print_exc()
        
        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps({'error': f'Internal server error: {str(e)}'})
        }


def enrich_company_with_harmonic(identifier_key: str, identifier_value: str) -> Dict[str, Any]:
    """
    Call Harmonic AI API to enrich company data
    """
    try:
        # Get Harmonic API key from environment
        api_key = os.environ.get('HARMONIC_API_KEY')
        if not api_key:
            return {'error': 'Harmonic API key not configured'}
        
        # Prepare the API request
        url = 'https://api.harmonic.ai/companies'
        
        # Correct Harmonic API authentication format
        headers = {
            'apikey': api_key,
            'Content-Type': 'application/json'
        }
        
        # Identifier goes as query parameter, not JSON body
        params = {
            identifier_key: identifier_value
        }
        
        print(f"Calling Harmonic API with params: {params}")
        
        # Make the API call
        response = requests.post(url, headers=headers, params=params, timeout=30)
        
        print(f"Harmonic API response status: {response.status_code}")
        print(f"Harmonic API response body: {response.text}")
        
        if response.status_code == 404:
            # Company not found or enrichment in progress
            response_data = response.json()
            enrichment_id = response_data.get('enrichment_id')
            
            if enrichment_id:
                return {
                    'status': 'enrichment_in_progress',
                    'enrichment_id': enrichment_id,
                    'message': 'Company enrichment is in progress. Check back in a couple hours.',
                    'estimated_completion': 'In 2-4 hours'
                }
            else:
                return {'error': 'Company not found in Harmonic database'}
        
        if response.status_code != 200:
            return {'error': f'Harmonic API error: {response.status_code} - {response.text}'}
        
        # Parse and return the enriched data
        enriched_data = response.json()
        
        # Extract key fields for easier frontend consumption
        extracted_data = extract_key_enrichment_fields(enriched_data)
        
        return {
            'status': 'success',
            'raw_data': enriched_data,
            'extracted': extracted_data,
            'enriched_at': datetime.utcnow().isoformat()
        }
        
    except requests.RequestException as e:
        print(f"Request error: {e}")
        return {'error': f'Failed to connect to Harmonic API: {str(e)}'}
    except Exception as e:
        print(f"Unexpected error in Harmonic API call: {e}")
        return {'error': f'Harmonic enrichment failed: {str(e)}'}


def extract_key_enrichment_fields(harmonic_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extract and format key fields from Harmonic response for frontend display
    Based on actual API response structure
    """
    try:
        extracted = {}
        
        # Basic company info
        extracted['name'] = harmonic_data.get('name')
        extracted['legal_name'] = harmonic_data.get('legal_name')
        extracted['description'] = harmonic_data.get('description')
        extracted['short_description'] = harmonic_data.get('short_description')
        extracted['external_description'] = harmonic_data.get('external_description')
        extracted['customer_type'] = harmonic_data.get('customer_type')
        extracted['company_type'] = harmonic_data.get('company_type')
        extracted['ownership_status'] = harmonic_data.get('ownership_status')
        extracted['logo_url'] = harmonic_data.get('logo_url')
        extracted['headcount'] = harmonic_data.get('headcount')
        extracted['stage'] = harmonic_data.get('stage')
        
        # Founding information - handle the actual structure
        founding_date = harmonic_data.get('founding_date')
        if founding_date and isinstance(founding_date, dict):
            extracted['founding_date'] = founding_date.get('date', '')[:4]  # Extract year from date string
        
        # Location - handle the actual structure
        location = harmonic_data.get('location')
        if location:
            extracted['location'] = {
                'city': location.get('city'),
                'state': location.get('state'), 
                'country': location.get('country'),
                'address': location.get('address_formatted'),
                'display': f"{location.get('city', '')}, {location.get('state', '')} {location.get('country', '')}".strip(', ')
            }
        
        # Enhanced Contact info
        contact = harmonic_data.get('contact')
        if contact:
            emails = contact.get('emails', [])
            exec_emails = contact.get('exec_emails', [])
            phones = contact.get('phone_numbers', [])
            extracted['contact'] = {
                'email': emails[0] if emails else None,
                'phone': phones[0] if phones else None,
                'primary_email': contact.get('primary_email'),
                'all_emails': emails[:5],  # Limit to top 5
                'exec_emails': exec_emails[:3],  # Executive emails
                'all_phones': phones[:3]
            }
        
        # Website info
        website = harmonic_data.get('website')
        if website:
            extracted['website'] = {
                'url': website.get('url'),
                'domain': website.get('domain'),
                'is_broken': website.get('is_broken', False)
            }
        
        # Website domain aliases
        domain_aliases = harmonic_data.get('website_domain_aliases', [])
        if domain_aliases:
            extracted['domain_aliases'] = domain_aliases[:10]
        
        # Name aliases
        name_aliases = harmonic_data.get('name_aliases', [])
        if name_aliases:
            extracted['name_aliases'] = name_aliases[:5]
        
        # Enhanced People & Leadership extraction
        people = harmonic_data.get('people', [])
        if people:
            extracted['leadership'] = []
            extracted['people'] = []
            ceo_found = False
            
            for role in people[:25]:  # Check more roles
                if not isinstance(role, dict):
                    continue
                
                title = role.get('title', '')
                is_current = role.get('is_current_position', False)
                
                # Build role data
                role_data = {
                    'title': title,
                    'department': role.get('department'),
                    'is_current': is_current,
                    'location': role.get('location'),
                    'person_urn': role.get('person'),  # For future person enrichment
                    'start_date': role.get('start_date'),
                    'end_date': role.get('end_date'),
                    'description': role.get('description')
                }
                
                # Check for current CEO
                title_lower = title.lower()
                if (is_current and 
                    ('ceo' in title_lower or 'chief executive' in title_lower) and 
                    not ceo_found):
                    extracted['ceo'] = role_data
                    ceo_found = True
                
                # Add current executive roles
                if (is_current and 
                    any(keyword in title_lower for keyword in ['ceo', 'cto', 'cfo', 'chief', 'president', 'founder', 'vp', 'vice president'])):
                    extracted['leadership'].append(role_data)
                
                # Add all current people
                if is_current:
                    extracted['people'].append(role_data)
        
        # Funding Intelligence
        funding = harmonic_data.get('funding', {})
        if funding:
            extracted['funding'] = {
                'total': funding.get('funding_total'),
                'stage': funding.get('funding_stage'),
                'last_funding_at': funding.get('last_funding_at'),
                'valuation': funding.get('valuation'),
                'investors_count': len(funding.get('investors', []))
            }
            
            # Extract investors list
            investors = funding.get('investors', [])
            if investors:
                extracted['investors'] = []
                for inv in investors[:20]:  # Top 20 investors
                    if isinstance(inv, dict):
                        extracted['investors'].append({
                            'name': inv.get('name'),
                            'type': inv.get('type'),
                            'entity_urn': inv.get('entity_urn')
                        })
        
        # Funding per employee metric
        funding_per_employee = harmonic_data.get('funding_per_employee')
        if funding_per_employee:
            extracted['funding_per_employee'] = funding_per_employee
        
        # Detailed funding rounds
        funding_rounds = harmonic_data.get('funding_rounds', [])
        if funding_rounds:
            extracted['funding_rounds'] = []
            for round_data in funding_rounds[:10]:  # Latest 10 rounds
                if isinstance(round_data, dict):
                    extracted['funding_rounds'].append({
                        'type': round_data.get('funding_round_type'),
                        'amount': round_data.get('funding_amount'),
                        'currency': round_data.get('funding_currency'),
                        'date': round_data.get('announcement_date'),
                        'valuation': round_data.get('post_money_valuation'),
                        'investors_count': len(round_data.get('investors', []))
                    })
        
        # Traction Metrics (Time Series Data)
        traction_metrics = harmonic_data.get('traction_metrics', {})
        if traction_metrics:
            extracted['traction_metrics'] = {}
            
            # Process each metric type
            for metric_name, metric_data in traction_metrics.items():
                if isinstance(metric_data, dict):
                    # Extract latest value and growth metrics
                    metric_info = {
                        'latest_value': metric_data.get('latest_metric_value'),
                        'growth_30d': metric_data.get('30d_ago', {}).get('percent_change'),
                        'growth_90d': metric_data.get('90d_ago', {}).get('percent_change'),
                        'growth_180d': metric_data.get('180d_ago', {}).get('percent_change'),
                        'growth_365d': metric_data.get('365d_ago', {}).get('percent_change')
                    }
                    
                    # Include recent data points for sparklines (last 12 months)
                    metrics_array = metric_data.get('metrics', [])
                    if metrics_array:
                        recent_metrics = metrics_array[:12]  # Last 12 data points
                        metric_info['sparkline_data'] = [
                            {
                                'timestamp': m.get('timestamp'),
                                'value': m.get('metric_value')
                            } for m in recent_metrics if isinstance(m, dict)
                        ]
                    
                    extracted['traction_metrics'][metric_name] = metric_info
        
        # Social Media Links
        socials = harmonic_data.get('socials', {})
        if socials:
            extracted['socials'] = {}
            for platform, social_data in socials.items():
                if isinstance(social_data, dict):
                    extracted['socials'][platform.lower()] = {
                        'url': social_data.get('url'),
                        'handle': social_data.get('handle'),
                        'followers': social_data.get('followers')
                    }
        
        # Related Companies Network (Real API Fields Only)
        related_companies = harmonic_data.get('related_companies', {})
        if related_companies:
            extracted['related_companies'] = {
                'acquisitions': related_companies.get('acquisitions', [])[:15],
                'acquired_by': related_companies.get('acquired_by'),
                'subsidiaries': related_companies.get('subsidiaries', [])[:15],
                'subsidiary_of': related_companies.get('subsidiary_of'),
                'prior_stealth_association': related_companies.get('prior_stealth_association', {}),
                'beta_notice': related_companies.get('beta_notice')
            }
        
        # Employee Highlights (Top Talent Insights)
        employee_highlights = harmonic_data.get('employee_highlights', [])
        if employee_highlights:
            extracted['employee_highlights'] = {}
            
            # Group by category
            for highlight in employee_highlights[:50]:  # Top 50 highlights
                if isinstance(highlight, dict):
                    category = highlight.get('category', 'Other')
                    text = highlight.get('text', '')
                    
                    if category not in extracted['employee_highlights']:
                        extracted['employee_highlights'][category] = []
                    
                    if len(extracted['employee_highlights'][category]) < 10:  # Max 10 per category
                        extracted['employee_highlights'][category].append(text)
        
        # Enhanced Tags with v2 support
        def _extract_tag_info(tag):
            if isinstance(tag, dict):
                return {
                    'display_value': tag.get('display_value', ''),
                    'type': tag.get('type', ''),
                    'category': tag.get('category', '')
                }
            return {'display_value': str(tag), 'type': '', 'category': ''}
        
        tags_v2 = harmonic_data.get('tags_v2', [])
        if tags_v2:
            extracted['tags_v2'] = {}
            for tag in tags_v2[:20]:  # Top 20 tags
                tag_info = _extract_tag_info(tag)
                tag_type = tag_info['type'] or 'general'
                
                if tag_type not in extracted['tags_v2']:
                    extracted['tags_v2'][tag_type] = []
                
                if tag_info['display_value'] and len(extracted['tags_v2'][tag_type]) < 5:
                    extracted['tags_v2'][tag_type].append(tag_info['display_value'])
        
        # Legacy tags for backward compatibility
        tags = harmonic_data.get('tags', [])
        if tags:
            extracted['tags'] = []
            for tag in tags[:10]:
                tag_info = _extract_tag_info(tag)
                if tag_info['display_value']:
                    extracted['tags'].append(tag_info['display_value'])
        
        # Company highlights
        highlights = harmonic_data.get('highlights', [])
        if highlights:
            extracted['highlights'] = []
            for h in highlights[:5]:
                if isinstance(h, dict):
                    extracted['highlights'].append(h.get('text', ''))
                else:
                    extracted['highlights'].append(str(h))
        
        # Web traffic
        web_traffic = harmonic_data.get('web_traffic')
        if web_traffic:
            extracted['web_traffic'] = web_traffic
        
        return extracted
        
    except Exception as e:
        print(f"Error extracting enrichment fields: {e}")
        import traceback
        traceback.print_exc()
        return {'error': f'Failed to extract enrichment data: {str(e)}'}


def save_enrichment_to_database(company_id: str, enrichment_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Save enriched company data to the database
    """
    try:
        # Database configuration
        db_config = {
            'host': os.environ.get('DB_HOST'),
            'port': int(os.environ.get('DB_PORT', '5432')),
            'database': os.environ.get('DB_NAME'),
            'user': os.environ.get('DB_USER'),
            'password': os.environ.get('DB_PASSWORD'),
        }
        
        # Connect to database
        ssl_context = ssl.create_default_context()
        conn = pg8000.connect(**db_config, ssl_context=ssl_context, timeout=30)
        cursor = conn.cursor()
        
        # Note: Tables should be created by the create-schema function
        # No schema creation logic here to avoid conflicts
        
        # Insert or update enrichment data
        harmonic_urn = enrichment_data.get('raw_data', {}).get('entity_urn')
        extracted = enrichment_data.get('extracted', {})
        
        # Extract structured fields for better querying
        funding_data = extracted.get('funding', {})
        location_data = extracted.get('location', {})
        
        upsert_sql = """
        INSERT INTO company_enrichments (
            company_id, harmonic_entity_urn, harmonic_data, extracted_data, 
            enrichment_status, enriched_at, updated_at,
            funding_total, funding_stage, valuation, headcount, web_traffic,
            stage, company_type, location_city, location_state, location_country
        ) VALUES (%s, %s, %s, %s, %s, %s, NOW(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (company_id) 
        DO UPDATE SET 
            harmonic_entity_urn = EXCLUDED.harmonic_entity_urn,
            harmonic_data = EXCLUDED.harmonic_data,
            extracted_data = EXCLUDED.extracted_data,
            enrichment_status = EXCLUDED.enrichment_status,
            enriched_at = EXCLUDED.enriched_at,
            updated_at = NOW(),
            funding_total = EXCLUDED.funding_total,
            funding_stage = EXCLUDED.funding_stage,
            valuation = EXCLUDED.valuation,
            headcount = EXCLUDED.headcount,
            web_traffic = EXCLUDED.web_traffic,
            stage = EXCLUDED.stage,
            company_type = EXCLUDED.company_type,
            location_city = EXCLUDED.location_city,
            location_state = EXCLUDED.location_state,
            location_country = EXCLUDED.location_country
        RETURNING id;
        """
        
        cursor.execute(upsert_sql, [
            int(company_id),
            harmonic_urn,
            json.dumps(enrichment_data.get('raw_data', {})),
            json.dumps(extracted),
            enrichment_data.get('status', 'success'),
            enrichment_data.get('enriched_at'),
            funding_data.get('total'),
            funding_data.get('stage'),
            funding_data.get('valuation'),
            extracted.get('headcount'),
            extracted.get('web_traffic'),
            extracted.get('stage'),
            extracted.get('company_type'),
            location_data.get('city'),
            location_data.get('state'),
            location_data.get('country')
        ])
        
        enrichment_id = cursor.fetchone()[0]
        
        # Enrich CEO/leadership if available
        ceo_data = extracted.get('ceo')
        leadership_data = extracted.get('leadership', [])
        
        if ceo_data and ceo_data.get('person_urn'):
            # Enrich CEO in background (non-blocking)
            try:
                enrich_person_background(ceo_data['person_urn'], company_id, ceo_data.get('title', 'CEO'))
            except Exception as e:
                print(f"CEO enrichment failed (non-blocking): {e}")
        
        # Enrich top 3 leadership members
        for leader in leadership_data[:3]:
            if leader.get('person_urn'):
                try:
                    enrich_person_background(leader['person_urn'], company_id, leader.get('title', 'Executive'))
                except Exception as e:
                    print(f"Leadership enrichment failed (non-blocking): {e}")
        
        # Commit the transaction
        conn.commit()
        cursor.close()
        conn.close()
        
        return {
            'success': True,
            'enrichment_id': enrichment_id,
            'company_id': company_id
        }
        
    except Exception as e:
        print(f"Database save error: {e}")
        import traceback
        traceback.print_exc()
        return {'error': f'Failed to save enrichment to database: {str(e)}'}


def get_company_enrichment(company_id: str) -> Dict[str, Any]:
    """
    Retrieve existing enrichment data for a company
    """
    try:
        # Database configuration
        db_config = {
            'host': os.environ.get('DB_HOST'),
            'port': int(os.environ.get('DB_PORT', '5432')),
            'database': os.environ.get('DB_NAME'),
            'user': os.environ.get('DB_USER'),
            'password': os.environ.get('DB_PASSWORD'),
        }
        
        # Connect to database
        ssl_context = ssl.create_default_context()
        conn = pg8000.connect(**db_config, ssl_context=ssl_context, timeout=30)
        cursor = conn.cursor()
        
        # Query for existing enrichment
        query_sql = """
        SELECT harmonic_data, extracted_data, enrichment_status, enriched_at
        FROM company_enrichments 
        WHERE company_id = %s 
        ORDER BY enriched_at DESC 
        LIMIT 1;
        """
        
        cursor.execute(query_sql, [int(company_id)])
        result = cursor.fetchone()
        
        cursor.close()
        conn.close()
        
        if result:
            return {
                'success': True,
                'data': {
                    'harmonic_data': result[0],
                    'extracted_data': result[1],
                    'status': result[2],
                    'enriched_at': result[3].isoformat() if result[3] else None
                }
            }
        else:
            return {'success': True, 'data': None}
            
    except Exception as e:
        print(f"Database query error: {e}")
        return {'error': f'Failed to retrieve enrichment data: {str(e)}'}


def enrich_person_background(person_urn: str, company_id: str, title: str) -> None:
    """
    Enrich person data in background (non-blocking)
    """
    try:
        # Check if person already enriched recently (within 30 days)
        if is_person_recently_enriched(person_urn):
            print(f"Person {person_urn} recently enriched, skipping")
            return
        
        # Call Harmonic persons API
        person_data = enrich_person_with_harmonic(person_urn)
        
        if person_data and not person_data.get('error'):
            # Save person enrichment to database
            save_person_enrichment(person_urn, company_id, title, person_data)
            print(f"Successfully enriched person: {person_urn}")
        else:
            print(f"Person enrichment failed for {person_urn}: {person_data.get('error', 'Unknown error')}")
            
    except Exception as e:
        print(f"Person enrichment background task failed: {e}")


def enrich_person_with_harmonic(person_urn: str) -> Optional[Dict[str, Any]]:
    """
    Call Harmonic AI persons API to enrich person data using URN
    """
    try:
        # Get Harmonic API key from environment
        api_key = os.environ.get('HARMONIC_API_KEY')
        if not api_key:
            return {'error': 'Harmonic API key not configured'}
        
        print(f"Enriching person with URN: {person_urn}")
        
        # Call Harmonic persons API with URN
        url = f'https://api.harmonic.ai/persons/{person_urn}'
        headers = {
            'apikey': api_key,
            'Content-Type': 'application/json'
        }
        
        response = requests.get(url, headers=headers, timeout=30)
        
        print(f"Person API response status: {response.status_code}")
        
        if response.status_code == 404:
            print(f"Person not found: {person_urn}")
            return {'error': 'Person not found'}
        
        if response.status_code != 200:
            print(f"Person API error: {response.status_code} - {response.text}")
            return {'error': f'Person API error: {response.status_code}'}
        
        # Parse and return the person data
        person_data = response.json()
        print(f"Successfully enriched person: {person_data.get('full_name', person_urn)}")
        
        return person_data
        
    except requests.RequestException as e:
        print(f"Person API request error: {e}")
        return {'error': f'Person enrichment request failed: {str(e)}'}
    except Exception as e:
        print(f"Person API call error: {e}")
        return {'error': f'Person enrichment failed: {str(e)}'}


def is_person_recently_enriched(person_urn: str) -> bool:
    """
    Check if person was enriched recently (within 30 days)
    """
    try:
        # Database configuration
        db_config = {
            'host': os.environ.get('DB_HOST'),
            'port': int(os.environ.get('DB_PORT', '5432')),
            'database': os.environ.get('DB_NAME'),
            'user': os.environ.get('DB_USER'),
            'password': os.environ.get('DB_PASSWORD'),
        }
        
        # Connect to database
        ssl_context = ssl.create_default_context()
        conn = pg8000.connect(**db_config, ssl_context=ssl_context, timeout=30)
        cursor = conn.cursor()
        
        # Check for recent enrichment
        query_sql = """
        SELECT id FROM person_enrichments 
        WHERE person_urn = %s 
        AND enriched_at > NOW() - INTERVAL '30 days'
        LIMIT 1;
        """
        
        cursor.execute(query_sql, [person_urn])
        result = cursor.fetchone()
        
        cursor.close()
        conn.close()
        
        return result is not None
        
    except Exception as e:
        print(f"Error checking person enrichment status: {e}")
        return False


def save_person_enrichment(person_urn: str, company_id: str, title: str, person_data: Dict[str, Any]) -> None:
    """
    Save person enrichment data to database
    """
    try:
        # Database configuration
        db_config = {
            'host': os.environ.get('DB_HOST'),
            'port': int(os.environ.get('DB_PORT', '5432')),
            'database': os.environ.get('DB_NAME'),
            'user': os.environ.get('DB_USER'),
            'password': os.environ.get('DB_PASSWORD'),
        }
        
        # Connect to database
        ssl_context = ssl.create_default_context()
        conn = pg8000.connect(**db_config, ssl_context=ssl_context, timeout=30)
        cursor = conn.cursor()
        
        # Extract person info
        full_name = person_data.get('full_name', '')
        first_name = person_data.get('first_name', '')
        last_name = person_data.get('last_name', '')
        
        # Insert or update person enrichment
        upsert_sql = """
        INSERT INTO person_enrichments (
            person_urn, company_id, full_name, first_name, last_name, title,
            harmonic_data, extracted_data, enrichment_status, enriched_at, created_at, updated_at
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW(), NOW())
        ON CONFLICT (person_urn) 
        DO UPDATE SET 
            company_id = EXCLUDED.company_id,
            full_name = EXCLUDED.full_name,
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            title = EXCLUDED.title,
            harmonic_data = EXCLUDED.harmonic_data,
            extracted_data = EXCLUDED.extracted_data,
            enrichment_status = EXCLUDED.enrichment_status,
            enriched_at = NOW(),
            updated_at = NOW()
        RETURNING id;
        """
        
        cursor.execute(upsert_sql, [
            person_urn,
            int(company_id),
            full_name,
            first_name,
            last_name,
            title,
            json.dumps(person_data),
            json.dumps({}),  # Extracted data placeholder
            'success'
        ])
        
        # Commit the transaction
        conn.commit()
        cursor.close()
        conn.close()
        
        print(f"Person enrichment saved for: {person_urn}")
        
    except Exception as e:
        print(f"Failed to save person enrichment: {e}")
        import traceback
        traceback.print_exc()


def handle_get_company_enrichment(body: Dict[str, Any], cors_headers: Dict[str, str]) -> Dict[str, Any]:
    """
    Handle requests to get existing company enrichment data
    """
    company_id = body.get('company_id')
    
    if not company_id:
        return {
            'statusCode': 400,
            'headers': cors_headers,
            'body': json.dumps({'error': 'company_id is required'})
        }
    
    print(f"Getting enrichment data for company ID: {company_id}")
    
    try:
        # Get existing enrichment data from database
        enrichment_result = get_company_enrichment(company_id)
        
        if enrichment_result.get('error'):
            return {
                'statusCode': 404,
                'headers': cors_headers,
                'body': json.dumps({'error': enrichment_result['error']})
            }
        
        if enrichment_result.get('success') and enrichment_result.get('data'):
            return {
                'statusCode': 200,
                'headers': cors_headers,
                'body': json.dumps({
                    'success': True,
                    'data': enrichment_result['data']
                })
            }
        else:
            return {
                'statusCode': 404,
                'headers': cors_headers,
                'body': json.dumps({'error': 'No enrichment data found'})
            }
        
    except Exception as e:
        print(f"Error getting enrichment data: {str(e)}")
        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps({
                'success': False,
                'error': f'Failed to get enrichment data: {str(e)}'
            })
        }


def handle_person_enrichment(body: Dict[str, Any], cors_headers: Dict[str, str]) -> Dict[str, Any]:
    """
    Handle person enrichment requests
    """
    person_urn = body.get('person_urn')
    
    if not person_urn:
        return {
            'statusCode': 400,
            'headers': cors_headers,
            'body': json.dumps({'error': 'person_urn is required'})
        }
    
    print(f"Starting person enrichment for URN: {person_urn}")
    
    try:
        # Call Harmonic AI persons API
        person_result = enrich_person_with_harmonic(person_urn)
        
        if person_result.get('error'):
            return {
                'statusCode': 500,
                'headers': cors_headers,
                'body': json.dumps({
                    'success': False,
                    'error': person_result['error']
                })
            }
        
        # Extract key person fields
        extracted_person_data = extract_key_person_fields(person_result)
        
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': json.dumps({
                'success': True,
                'data': {
                    'person_urn': person_urn,
                    'raw_data': person_result,
                    'extracted_data': extracted_person_data
                }
            })
        }
        
    except Exception as e:
        print(f"Person enrichment error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps({
                'success': False,
                'error': f'Person enrichment failed: {str(e)}'
            })
        }


def extract_key_person_fields(person_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extract key fields from Harmonic person response for frontend display
    """
    try:
        extracted = {}
        
        # Basic info
        extracted['full_name'] = person_data.get('name') or person_data.get('full_name')
        extracted['first_name'] = person_data.get('first_name')
        extracted['last_name'] = person_data.get('last_name')
        extracted['headline'] = person_data.get('linkedin_headline') or person_data.get('headline')
        extracted['summary'] = person_data.get('summary')
        
        # Contact info
        contact_data = {}
        if person_data.get('contact'):
            contact_data.update({
                'email': person_data['contact'].get('primary_email') or (person_data['contact'].get('emails', [{}])[0] if person_data['contact'].get('emails') else None),
                'phone': person_data['contact'].get('phone_numbers', [{}])[0] if person_data['contact'].get('phone_numbers') else None
            })
        
        # LinkedIn URL from socials
        if person_data.get('socials', {}).get('LINKEDIN', {}).get('url'):
            contact_data['linkedin_url'] = person_data['socials']['LINKEDIN']['url']
        
        if contact_data:
            extracted['contact'] = contact_data
        
        # Location
        if person_data.get('location'):
            extracted['location'] = {
                'city': person_data['location'].get('city'),
                'state': person_data['location'].get('state'),
                'country': person_data['location'].get('country'),
                'display': person_data['location'].get('display')
            }
        
        # Current position - get from experience array
        if person_data.get('experience'):
            for exp in person_data['experience']:
                if exp.get('is_current_position'):
                    extracted['current_position'] = {
                        'title': exp.get('title'),
                        'company': exp.get('company_name'),
                        'company_urn': exp.get('company'),
                        'start_date': exp.get('start_date'),
                        'description': exp.get('description'),
                        'location': exp.get('location')
                    }
                    break
        
        # Education
        if person_data.get('education'):
            extracted['education'] = []
            for edu in person_data['education'][:3]:  # Top 3 education entries
                extracted['education'].append({
                    'school': edu.get('school'),
                    'degree': edu.get('degree'),
                    'field': edu.get('field'),
                    'start_year': edu.get('start_year'),
                    'end_year': edu.get('end_year')
                })
        
        # Work experience
        if person_data.get('work_experience'):
            extracted['work_experience'] = []
            for exp in person_data['work_experience'][:5]:  # Top 5 work experiences
                extracted['work_experience'].append({
                    'title': exp.get('title'),
                    'company': exp.get('company'),
                    'company_urn': exp.get('company_urn'),
                    'start_date': exp.get('start_date'),
                    'end_date': exp.get('end_date'),
                    'duration': exp.get('duration'),
                    'description': exp.get('description')
                })
        
        # Skills
        if person_data.get('skills'):
            extracted['skills'] = person_data['skills'][:10]  # Top 10 skills
        
        return extracted
        
    except Exception as e:
        print(f"Error extracting person fields: {e}")
        return {}