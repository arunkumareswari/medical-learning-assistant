# backend/agents/pubmed_search.py
import requests
import hashlib
import json
from datetime import timedelta, datetime
from bs4 import BeautifulSoup
from typing import List, Dict

class PubMedSearchAgent:
    """
    Free PubMed API for medical literature search
    No API key required!
    """
    def __init__(self, mysql_db=None):
        self.base_url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/"
        self.mysql_db = mysql_db
        
        # PubMed is tier 1 credibility
        self.credibility_score = 100
    
    async def search(self, query: str, max_results: int = 5) -> dict:
        """Search PubMed for medical literature"""
        
        # Check cache first if MySQL is available
        if self.mysql_db:
            cache_key = self._hash_query(query)
            cached = self._get_cached_results(cache_key)
            if cached:
                return cached
        
        try:
            # Step 1: Search PubMed for article IDs
            search_results = self._search_pubmed(query, max_results)
            
            if not search_results:
                return {
                    'results': [],
                    'total_found': 0,
                    'search_metadata': {
                        'source': 'PubMed',
                        'cached': False,
                        'timestamp': str(datetime.now())
                    }
                }
            
            # Step 2: Fetch article details
            articles = self._fetch_article_details(search_results)
            
            # Step 3: Format results
            formatted_results = self._format_results(articles)
            
            # Cache results if MySQL is available
            if self.mysql_db:
                self._cache_results(cache_key, query, formatted_results)
            
            return formatted_results
            
        except Exception as e:
            print(f"PubMed search error: {e}")
            return {
                'results': [],
                'total_found': 0,
                'search_metadata': {
                    'source': 'PubMed',
                    'error': str(e),
                    'timestamp': str(datetime.now())
                }
            }
    
    def _search_pubmed(self, query: str, max_results: int) -> List[str]:
        """Search PubMed and get article IDs"""
        search_url = f"{self.base_url}esearch.fcgi"
        
        params = {
            'db': 'pubmed',
            'term': query,
            'retmax': max_results,
            'retmode': 'json',
            'sort': 'relevance'
        }
        
        response = requests.get(search_url, params=params, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            return data.get('esearchresult', {}).get('idlist', [])
        
        return []
    
    def _fetch_article_details(self, pmids: List[str]) -> List[Dict]:
        """Fetch detailed information for PubMed articles"""
        if not pmids:
            return []
        
        fetch_url = f"{self.base_url}efetch.fcgi"
        
        params = {
            'db': 'pubmed',
            'id': ','.join(pmids),
            'retmode': 'xml'
        }
        
        response = requests.get(fetch_url, params=params, timeout=10)
        
        if response.status_code != 200:
            return []
        
        # Parse XML response
        soup = BeautifulSoup(response.content, 'xml')
        articles = []
        
        for article in soup.find_all('PubmedArticle'):
            try:
                pmid = article.find('PMID').text if article.find('PMID') else 'N/A'
                
                # Title
                title_elem = article.find('ArticleTitle')
                title = title_elem.text if title_elem else 'No title'
                
                # Abstract
                abstract_elem = article.find('AbstractText')
                abstract = abstract_elem.text if abstract_elem else 'No abstract available'
                
                # Authors
                authors = []
                author_list = article.find('AuthorList')
                if author_list:
                    for author in author_list.find_all('Author')[:3]:  # First 3 authors
                        lastname = author.find('LastName')
                        forename = author.find('ForeName')
                        if lastname:
                            name = lastname.text
                            if forename:
                                name = f"{forename.text} {name}"
                            authors.append(name)
                
                # Publication date
                pub_date = article.find('PubDate')
                year = pub_date.find('Year').text if pub_date and pub_date.find('Year') else 'N/A'
                
                # Journal
                journal_elem = article.find('Title')  # Journal title
                journal = journal_elem.text if journal_elem else 'Unknown Journal'
                
                articles.append({
                    'pmid': pmid,
                    'title': title,
                    'abstract': abstract[:500],  # First 500 chars
                    'authors': ', '.join(authors) if authors else 'Unknown',
                    'year': year,
                    'journal': journal,
                    'url': f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"
                })
                
            except Exception as e:
                print(f"Error parsing article: {e}")
                continue
        
        return articles
    
    def _format_results(self, articles: List[Dict]) -> dict:
        """Format articles for consistent output"""
        results = []
        
        for article in articles:
            results.append({
                'title': article['title'],
                'url': article['url'],
                'snippet': f"{article['abstract'][:200]}...",
                'content': article['abstract'],
                'credibility_score': self.credibility_score,
                'tier': 'tier1',
                'metadata': {
                    'authors': article['authors'],
                    'year': article['year'],
                    'journal': article['journal'],
                    'pmid': article['pmid']
                }
            })
        
        return {
            'results': results,
            'total_found': len(results),
            'search_metadata': {
                'source': 'PubMed',
                'cached': False,
                'timestamp': str(datetime.now())
            }
        }
    
    def _hash_query(self, query: str) -> str:
        """Generate cache key"""
        return hashlib.md5(query.encode()).hexdigest()
    
    def _get_cached_results(self, query_hash: str):
        """Get cached results from MySQL"""
        if not self.mysql_db:
            return None
        
        try:
            cached = self.mysql_db.get_cached_search(query_hash)
            if cached:
                return json.loads(cached['results_json'])
        except:
            pass
        
        return None
    
    def _cache_results(self, query_hash: str, query_text: str, results: dict):
        """Cache results in MySQL"""
        if not self.mysql_db:
            return
        
        try:
            self.mysql_db.cache_search_results(
                query_hash=query_hash,
                query_text=query_text,
                results=results,
                ttl_days=7
            )
        except Exception as e:
            print(f"Cache error: {e}")