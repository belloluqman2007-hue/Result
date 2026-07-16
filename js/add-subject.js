/*function saveSubject(){

    let subjectName =
    document.getElementById("subjectName").value;

    fetch("http://localhost:3000/save-subject",{

        method:"POST",

        headers:{
            "Content-Type":"application/json"
        },

        body:JSON.stringify({

            subject_name:subjectName

        })

    })

    .then(response=>response.json())

    .then(data=>{

        alert(data.message);

        document.getElementById("subjectName").value="";

    })

    .catch(error=>console.log(error));

}
*/