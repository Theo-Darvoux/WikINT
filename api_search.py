import uuid
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import or_, func, and_
from db.database import get_db
from db.models import Student, Club

router = APIRouter(prefix="/search", tags=["search"])

@router.get("")
async def global_search(q: str = "", db: AsyncSession = Depends(get_db)):
    if not q or len(q) < 2:
        return {"students": [], "clubs": [], "apartments": []}

    query_clean = q.strip().lower()
    search_terms = query_clean.split()
    
    # 1. SEARCH STUDENTS
    # For high reward, we use an AND logic for terms: 
    # Every term must match at least one field (Fname, Lname, ID, or Apt)
    term_conditions = []
    for term in search_terms:
        term_conditions.append(
            or_(
                func.unaccent(Student.first_name).ilike(func.unaccent(f"%{term}%")),
                func.unaccent(Student.last_name).ilike(func.unaccent(f"%{term}%")),
                func.unaccent(Student.trombint_id).ilike(f"%{term}%"),
                func.unaccent(Student.apartment).ilike(f"%{term}%")
            )
        )
    
    student_query = select(Student).where(and_(*term_conditions)).limit(40)
    
    student_res = await db.execute(student_query)
    students_raw = student_res.scalars().all()
    
    ranked_students = []
    for s in students_raw:
        score = 0
        fname = s.first_name.lower()
        lname = s.last_name.lower()
        tid = s.trombint_id.lower()
        apt = (s.apartment or "").lower()
        
        # Priority 1: Exact matches on high-value tokens
        if tid == query_clean: score += 100
        if apt == query_clean: score += 95
        
        # Priority 2: Term Coverage (Higher reward for matching MORE parts of the name)
        # e.g. "alexis ross" matches both first and last name
        matched_terms = 0
        for term in search_terms:
            term_score = 0
            if term == fname: term_score += 40
            elif fname.startswith(term): term_score += 20
            elif term in fname: term_score += 5
            
            if term == lname: term_score += 50
            elif lname.startswith(term): term_score += 30
            elif term in lname: term_score += 10
            
            if term_score > 0:
                score += term_score
                matched_terms += 1
        
        # Multi-term bonus: If query is multi-word and we hit multiple fields
        if len(search_terms) > 1 and matched_terms >= len(search_terms):
            score += 50 

        # Full name phrase match
        full_name = f"{fname} {lname}"
        rev_name = f"{lname} {fname}"
        if query_clean in full_name: score += 40
        if query_clean in rev_name: score += 35
            
        ranked_students.append((score, s))
    
    ranked_students.sort(key=lambda x: x[0], reverse=True)
    
    # 2. SEARCH CLUBS
    club_query = select(Club).where(
        or_(
            func.unaccent(Club.name).ilike(func.unaccent(f"%{query_clean}%")),
            func.unaccent(Club.slug).ilike(f"%{query_clean}%")
        )
    ).limit(10)
    club_res = await db.execute(club_query)
    clubs_raw = club_res.scalars().all()
    
    ranked_clubs = []
    for c in clubs_raw:
        score = 0
        name = c.name.lower()
        slug = (c.slug or "").lower()
        if name == query_clean: score += 100
        if slug == query_clean: score += 90
        if name.startswith(query_clean): score += 50
        ranked_clubs.append((score, c))
    ranked_clubs.sort(key=lambda x: x[0], reverse=True)

    return {
        "students": [
            {
                "id": str(s.id),
                "first_name": s.first_name,
                "last_name": s.last_name,
                "trombint_id": s.trombint_id,
                "apartment": s.apartment
            } for score, s in ranked_students[:15]
        ],
        "clubs": [
            {
                "id": str(c.id),
                "name": c.name,
                "slug": c.slug,
                "logo_url": c.logo_url
            } for score, c in ranked_clubs[:5]
        ],
        "apartments": [
            {
                "apartment_id": s.apartment,
                "student_id": str(s.id),
                "student_name": f"{s.first_name} {s.last_name}"
            } for score, s in ranked_students if s.apartment and (
                any(term in s.apartment.lower() for term in search_terms)
            )
        ][:5]
    }
