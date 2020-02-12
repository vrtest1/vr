using UnityEngine;
using UnityEngine.XR.MagicLeap;

public class moveobj : MonoBehaviour
{
    public GameObject moveobject;
    public Transform PlayerCam;

    [SerializeField, Tooltip("Controller")]
    ControllerConnectionHandler _controller = null;

    [SerializeField, Tooltip("Distance in front of Controller to create content")]
    float _distance = 0.2f;
  

    // Start is called before the first frame update
    void Start()
    {        
        MLInput.OnControllerButtonDown += HandleControllerButtonDown;
    }

    // Update is called once per frame
    void Update()
    {
        
    }

    void HandleControllerButtonDown(byte controllerId, MLInputControllerButton button)
    {

        if (button == MLInputControllerButton.Bumper)
        {
            Vector3 position = _controller.transform.position + _controller.transform.forward * _distance;
            moveobject.transform.position = position;            
            moveobject.transform.LookAt(PlayerCam);
        }    
    }
}
