"""
Cap Table Extraction Module

This module extracts cap table data from Excel files (.xlsx) specifically formatted
for Khosla Ventures. It handles:
- Company name extraction from metadata
- Investor data with ownership percentages
- Valuation and funding round information
- Pool data (options, available pool, etc.)

Database Schema Mapping:
- companies table: id, name, normalized_name
- cap_table table: company_id, investor, total_invested, final_fds, final_round_investment, valuation, round, file_name
- cap_table_summary table: company_id, latest_valuation, funding_round, investor_count, total_raised, latest_file_name
- pool_data table: company_id, total_pool_size, available_pool
"""

import pandas as pd
import io
import re
from typing import Dict, List, Any, Optional


def extract_cap_table_from_excel(blob: bytes, filename: str) -> Dict[str, Any]:
    """
    Extract cap table data from an Excel file blob.
    
    Args:
        blob: Excel file content as bytes
        filename: Name of the uploaded file
        
    Returns:
        Dictionary containing:
        - companyName: str
        - latestValuation: float
        - fundingRound: str
        - capTableData: List[Dict] (investor entries)
        - summary: Dict (pool and aggregate data)
    """
    
    try:
        # Read Excel file into memory
        file_content = io.BytesIO(blob)
        
        # Extract metadata (first 6 rows contain company info)
        df_metadata = pd.read_excel(file_content, nrows=6)
        company_name = df_metadata.columns[1]  # Company name is in column B header
        
        # Extract valuation and funding round from metadata
        latest_valuation, funding_round = _extract_metadata_values(df_metadata)
        
        # Reset file pointer and read main cap table data
        file_content.seek(0)
        df_data = pd.read_excel(file_content, skiprows=5).iloc[:, 1:]  # Skip first column (usually index)
        
        # Clean and prepare the data
        df_data = _clean_cap_table_data(df_data)
        
        # Extract investor data
        investor_data = _extract_investor_data(df_data, latest_valuation, funding_round)
        
        # Extract pool data
        pool_data = _extract_pool_data(df_data)
        
        # Calculate summary statistics
        summary = _calculate_summary(investor_data, pool_data)
        
        return {
            'companyName': company_name,
            'latestValuation': latest_valuation,
            'fundingRound': funding_round,
            'capTableData': investor_data,
            'summary': summary,
            'fileName': filename,
            'message': f'Successfully processed cap table with {len(investor_data)} investors'
        }
        
    except Exception as e:
        print(f"Error extracting cap table: {str(e)}")
        return {
            'error': f'Failed to extract cap table: {str(e)}',
            'companyName': filename.replace('.xlsx', ''),
            'capTableData': [],
            'summary': {}
        }


def _extract_metadata_values(df_metadata: pd.DataFrame) -> tuple[float, str]:
    """
    Extract valuation and funding round from metadata section.
    
    Args:
        df_metadata: DataFrame containing the first 6 rows of the Excel file
        
    Returns:
        Tuple of (valuation, funding_round)
    """
    latest_valuation = 0.0
    funding_round = ""
    
    try:
        # Convert metadata to string for pattern matching
        metadata_text = df_metadata.to_string().lower()
        
        # Look for valuation patterns
        valuation_patterns = [
            r'valuation[:\s]*\$?(\d+(?:,\d{3})*(?:\.\d+)?)\s*m',  # "valuation: $50M"
            r'valuation[:\s]*\$?(\d+(?:,\d{3})*(?:\.\d+)?)\s*million',  # "valuation: 50 million"
            r'post[- ]money[:\s]*\$?(\d+(?:,\d{3})*(?:\.\d+)?)\s*m',  # "post-money: $50M"
            r'\$(\d+(?:,\d{3})*(?:\.\d+)?)\s*m(?:illion)?',  # "$50M"
        ]
        
        for pattern in valuation_patterns:
            match = re.search(pattern, metadata_text)
            if match:
                val_str = match.group(1).replace(',', '')
                latest_valuation = float(val_str) * 1_000_000  # Convert millions to actual value
                break
        
        # Look for funding round patterns
        round_patterns = [
            r'(series\s+[a-z](?:\+)?)',  # "Series A", "Series B+"
            r'(seed)',
            r'(pre-seed)',
            r'(bridge)',
            r'(convertible)',
        ]
        
        for pattern in round_patterns:
            match = re.search(pattern, metadata_text)
            if match:
                funding_round = match.group(1).title()  # Capitalize properly
                break
                
    except Exception as e:
        print(f"Error extracting metadata: {e}")
        
    return latest_valuation, funding_round


def _clean_cap_table_data(df_data: pd.DataFrame) -> pd.DataFrame:
    """
    Clean and prepare cap table data for processing.
    
    Args:
        df_data: Raw cap table data from Excel
        
    Returns:
        Cleaned DataFrame with proper column names and data types
    """
    # Set first row as column headers
    df_data.columns = df_data.iloc[0]
    df_data = df_data[1:].reset_index(drop=True)
    
    # Make column names unique
    df_data.columns = _make_unique_columns(df_data.columns)
    
    # Set first column as "Investor"
    df_data.columns = ["Investor"] + df_data.columns.tolist()[1:]
    
    # Fill NaN values with 0 and infer data types
    df_data = df_data.fillna(0).infer_objects(copy=False)
    
    return df_data


def _make_unique_columns(columns) -> List[str]:
    """
    Ensure column names are unique by appending numbers to duplicates.
    
    Args:
        columns: List of column names
        
    Returns:
        List of unique column names
    """
    seen = {}
    unique_columns = []
    
    for col in columns:
        if col in seen:
            seen[col] += 1
            unique_columns.append(f"{col}_{seen[col]}")
        else:
            seen[col] = 1
            unique_columns.append(col)
    
    return unique_columns


def _extract_investor_data(df_data: pd.DataFrame, valuation: float, funding_round: str) -> List[Dict[str, Any]]:
    """
    Extract individual investor data from the cap table.
    
    Args:
        df_data: Cleaned cap table DataFrame
        valuation: Latest valuation from metadata
        funding_round: Funding round from metadata
        
    Returns:
        List of investor dictionaries
    """
    # Find the last "% FDS" column (Final Fully Diluted Shares)
    fds_columns = [col for col in df_data.columns if "% FDS" in col]
    last_fds_column = fds_columns[-1] if fds_columns else None
    df_data["Final % FDS"] = df_data[last_fds_column] if last_fds_column else 0
    
    # Find "Total $ Invested" columns and calculate totals
    invested_columns = [col for col in df_data.columns if "Total $ Invested" in col]
    df_data[invested_columns] = df_data[invested_columns].apply(pd.to_numeric, errors='coerce')
    df_data["Total Invested"] = df_data[invested_columns].sum(axis=1)
    
    # Get final round investment (from last invested column)
    last_invested_column = invested_columns[-1] if invested_columns else None
    df_data["Final Round Investment"] = df_data[last_invested_column] if last_invested_column else 0
    
    # Remove unwanted rows (system entries, not actual investors)
    excluded_investors = [
        "Warrants Preferred", "Warrants Common", "Options Outstanding", 
        "Option Pool Available", "Pool Increase", "TOTAL"
    ]
    df_data = df_data[~df_data["Investor"].isin(excluded_investors)]
    df_data = df_data[df_data["Investor"] != "0"]
    
    # Convert to list of dictionaries
    investor_data = []
    for _, row in df_data.iterrows():
        investor_data.append({
            'investor': row["Investor"],
            'total_invested': float(row["Total Invested"]) if pd.notna(row["Total Invested"]) else 0.0,
            'final_fds': float(row["Final % FDS"]) if pd.notna(row["Final % FDS"]) else 0.0,
            'final_round_investment': float(row["Final Round Investment"]) if pd.notna(row["Final Round Investment"]) else 0.0,
            'valuation': valuation,
            'round': funding_round
        })
    
    return investor_data


def _extract_pool_data(df_data: pd.DataFrame) -> Dict[str, float]:
    """
    Extract option pool data from the cap table.
    
    Args:
        df_data: Cleaned cap table DataFrame
        
    Returns:
        Dictionary containing pool data
    """
    def get_value(investor_name: str, column: str) -> float:
        """Helper function to get value for specific investor/row."""
        if column not in df_data.columns:
            return 0.0
        
        # Normalize investor column for safe comparison
        df_data["Investor"] = df_data["Investor"].astype(str).str.strip()
        
        # Find the row
        row = df_data[df_data["Investor"] == investor_name]
        if row.empty:
            return 0.0
        
        value = row[column].values[0]
        return float(value) if pd.notna(value) else 0.0
    
    # Extract pool-related values
    final_fds_column = "Final % FDS"
    
    options_outstanding = get_value("Options Outstanding", final_fds_column)
    pool_increase = get_value("Pool Increase", final_fds_column)
    available_pool = get_value("Option Pool Available", final_fds_column)
    
    total_pool_size = options_outstanding + pool_increase
    
    return {
        'totalPoolSize': total_pool_size,
        'availablePool': available_pool,
        'optionsOutstanding': options_outstanding,
        'poolIncrease': pool_increase
    }


def _calculate_summary(investor_data: List[Dict[str, Any]], pool_data: Dict[str, float]) -> Dict[str, Any]:
    """
    Calculate summary statistics for the cap table.
    
    Args:
        investor_data: List of investor dictionaries
        pool_data: Pool data dictionary
        
    Returns:
        Summary statistics dictionary
    """
    total_raised = sum(inv['total_invested'] for inv in investor_data)
    investor_count = len(investor_data)
    
    return {
        'totalRaised': total_raised,
        'investorCount': investor_count,
        'totalPoolSize': pool_data['totalPoolSize'],
        'availablePool': pool_data['availablePool']
    }


def _num(val: Any) -> float:
    """
    Convert any value to a finite float for JSON serialization.
    
    Args:
        val: Value to convert
        
    Returns:
        Float value (0.0 if conversion fails)
    """
    try:
        import math
        x = float(val)
        return x if math.isfinite(x) else 0.0
    except (TypeError, ValueError):
        return 0.0 